import { computeArbs } from '@surebet/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramAlert } from './alert.js';
import { planArbSync } from './arb-sync.js';
import type { WorkerConfig } from './config.js';
import { applyArbSync, getActiveArbRefs, upsertEventsAndOdds } from './db.js';
import { normalizeEvents } from './normalize.js';
import { fetchOdds } from './odds-api.js';

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await sleepFn(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

export interface CycleResult {
  failed: number;
  requestsRemaining: number | null;
  requestsUsed: number | null;
}

export interface CycleDeps {
  fetchOdds: typeof fetchOdds;
  normalizeEvents: typeof normalizeEvents;
  computeArbs: typeof computeArbs;
  sendTelegramAlert: typeof sendTelegramAlert;
  sleep: (ms: number) => Promise<void>;
}

export async function runCycle(
  db: SupabaseClient,
  config: WorkerConfig,
  deps: Partial<CycleDeps> = {},
): Promise<CycleResult> {
  const d: CycleDeps = {
    fetchOdds,
    normalizeEvents,
    computeArbs,
    sendTelegramAlert,
    sleep: defaultSleep,
    ...deps,
  };

  let failed = 0;
  let requestsRemaining: number | null = null;
  let requestsUsed: number | null = null;

  for (const sport of config.sports) {
    const started = Date.now();
    try {
      const result = await withRetry(() => d.fetchOdds(sport, config.oddsApiKey), 3, d.sleep);
      requestsRemaining = result.requestsRemaining ?? requestsRemaining;
      requestsUsed = result.requestsUsed ?? requestsUsed;

      const odds = d.normalizeEvents(result.events);
      if (odds.length > 0) await upsertEventsAndOdds(db, odds);

      const arbs = d.computeArbs(odds);
      const active = await getActiveArbRefs(db, sport);
      const plan = planArbSync(arbs, active);
      await applyArbSync(db, plan);

      console.log(JSON.stringify({
        level: 'info', sport,
        events: result.events.length, oddsRows: odds.length,
        arbs: arbs.length, novos: plan.inserts.length, gone: plan.goneIds.length,
        requestsRemaining, requestsUsed, ms: Date.now() - started,
      }));
    } catch (err) {
      failed++;
      console.error(JSON.stringify({
        level: 'error', sport, err: String(err), ms: Date.now() - started,
      }));
    }
  }
  return { failed, requestsRemaining, requestsUsed };
}
