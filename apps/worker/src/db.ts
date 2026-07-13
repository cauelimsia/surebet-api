import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Arb, NormalizedOdd } from '@surebet/core';
import type { ActiveArbRef, ArbSyncPlan } from './arb-sync.js';

export function createDb(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

export async function upsertSports(db: SupabaseClient, sportKeys: string[]): Promise<void> {
  const rows = sportKeys.map((key) => ({ key, title: key }));
  const { error } = await db.from('sports').upsert(rows);
  if (error) throw new Error(`upsert sports: ${error.message}`);
}

export async function upsertEventsAndOdds(
  db: SupabaseClient,
  odds: NormalizedOdd[],
): Promise<void> {
  const events = new Map<string, Record<string, unknown>>();
  for (const odd of odds) {
    events.set(odd.eventId, {
      id: odd.eventId,
      sport_key: odd.sportKey,
      home_team: odd.homeTeam,
      away_team: odd.awayTeam,
      commence_time: odd.commenceTime,
    });
  }
  const eventsRes = await db.from('events').upsert([...events.values()]);
  if (eventsRes.error) throw new Error(`upsert events: ${eventsRes.error.message}`);

  const oddsRows = odds.map((odd) => ({
    event_id: odd.eventId,
    bookmaker: odd.bookmaker,
    market: odd.market,
    outcome: odd.outcome,
    point: odd.point,
    price: odd.price,
    last_update: odd.lastUpdate,
  }));
  const oddsRes = await db.from('odds').upsert(oddsRows);
  if (oddsRes.error) throw new Error(`upsert odds: ${oddsRes.error.message}`);
}

export async function getActiveArbRefs(
  db: SupabaseClient,
  sportKey: string,
): Promise<ActiveArbRef[]> {
  const { data, error } = await db
    .from('arbs')
    .select('id, arb_key, events!inner(sport_key)')
    .eq('status', 'active')
    .eq('events.sport_key', sportKey);
  if (error) throw new Error(`get active arbs: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id as string, arbKey: row.arb_key as string }));
}

export async function applyArbSync(db: SupabaseClient, plan: ArbSyncPlan): Promise<void> {
  const nowIso = new Date().toISOString();

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((arb) => ({
      arb_key: arb.arbKey,
      event_id: arb.eventId,
      market: arb.market,
      point: arb.point,
      profit_pct: arb.profitPct,
      legs: arb.legs,
      status: 'active',
    }));
    const { error } = await db.from('arbs').insert(rows);
    if (error) throw new Error(`insert arbs: ${error.message}`);
  }

  for (const { id, arb } of plan.updates) {
    const { error } = await db
      .from('arbs')
      .update({ profit_pct: arb.profitPct, legs: arb.legs, updated_at: nowIso })
      .eq('id', id);
    if (error) throw new Error(`update arb ${id}: ${error.message}`);
  }

  if (plan.goneIds.length > 0) {
    const { error } = await db
      .from('arbs')
      .update({ status: 'gone', gone_at: nowIso, updated_at: nowIso })
      .in('id', plan.goneIds);
    if (error) throw new Error(`mark gone: ${error.message}`);
  }
}
