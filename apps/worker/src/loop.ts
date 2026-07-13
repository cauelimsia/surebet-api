import { computeArbs } from '@surebet/core';
import type { SupabaseClient } from '@supabase/supabase-js';
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
}

export async function runCycle(
  db: SupabaseClient,
  config: WorkerConfig,
): Promise<CycleResult> {
  let failed = 0;
  let requestsRemaining: number | null = null;

  for (const sport of config.sports) {
    const started = Date.now();
    try {
      const result = await withRetry(() => fetchOdds(sport, config.oddsApiKey), 3);
      requestsRemaining = result.requestsRemaining ?? requestsRemaining;

      const odds = normalizeEvents(result.events);
      if (odds.length > 0) await upsertEventsAndOdds(db, odds);

      const arbs = computeArbs(odds);
      const active = await getActiveArbRefs(db, sport);
      const plan = planArbSync(arbs, active);
      await applyArbSync(db, plan);

      console.log(JSON.stringify({
        level: 'info', sport,
        events: result.events.length, oddsRows: odds.length,
        arbs: arbs.length, novos: plan.inserts.length, gone: plan.goneIds.length,
        requestsRemaining, ms: Date.now() - started,
      }));
    } catch (err) {
      failed++;
      console.error(JSON.stringify({
        level: 'error', sport, err: String(err), ms: Date.now() - started,
      }));
    }
  }
  return { failed, requestsRemaining };
}
