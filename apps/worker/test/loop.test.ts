import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../src/config.js';
import { runCycle, withRetry } from '../src/loop.js';
import type { OddsApiEvent } from '../src/odds-api.js';

const noSleep = async (): Promise<void> => {};

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'odds-api-soccer.json'), 'utf8'),
) as OddsApiEvent[];

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    oddsApiKey: 'test-key',
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role',
    sports: ['soccer_epl'],
    pollIntervalSeconds: 60,
    monthlyQuota: 500,
    runOnce: true,
    ...overrides,
  };
}

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function makeFakeDb(): { db: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  function from(table: string): unknown {
    const record = (method: string) => (...args: unknown[]): unknown => {
      calls.push({ table, method, args });
      return api;
    };
    const api: Record<string, unknown> = {
      select: record('select'),
      eq: record('eq'),
      insert: record('insert'),
      update: record('update'),
      upsert: record('upsert'),
      in: record('in'),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    return api;
  }

  return { db: { from } as unknown as SupabaseClient, calls };
}

describe('withRetry', () => {
  it('retorna no primeiro sucesso', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, 3, noSleep);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('tenta de novo após falha e retorna sucesso', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return 'ok';
    }, 3, noSleep);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('esgota tentativas e propaga o último erro', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error('sempre falha');
      }, 3, noSleep),
    ).rejects.toThrow('sempre falha');
    expect(calls).toBe(3);
  });
});

describe('runCycle', () => {
  it('processa um esporte com sucesso: aplica o plano de arbs e reporta as cotas', async () => {
    const { db, calls } = makeFakeDb();
    const config = makeConfig();

    const result = await runCycle(db, config, {
      sleep: noSleep,
      fetchOdds: async () => ({
        events: fixture,
        requestsRemaining: 480,
        requestsUsed: 20,
      }),
    });

    expect(result.failed).toBe(0);
    expect(result.requestsRemaining).toBe(480);
    expect(result.requestsUsed).toBe(20);

    const insertCall = calls.find((c) => c.table === 'arbs' && c.method === 'insert');
    expect(insertCall).toBeDefined();
    const rows = insertCall!.args[0] as { arb_key: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].arb_key).toBe('e912304de2b2ce35b473ce2ecd3d1502|h2h|0');
  });

  it('continua para o próximo esporte quando fetchOdds falha em um deles, sem lançar', async () => {
    const { db, calls } = makeFakeDb();
    const config = makeConfig({ sports: ['soccer_epl', 'basketball_nba'] });
    const seen: string[] = [];

    const result = await runCycle(db, config, {
      sleep: noSleep,
      fetchOdds: async (sportKey: string) => {
        seen.push(sportKey);
        if (sportKey === 'soccer_epl') throw new Error('api fora do ar');
        return { events: fixture, requestsRemaining: 300, requestsUsed: 200 };
      },
    });

    expect(result.failed).toBe(1);
    // soccer_epl: 3 tentativas (withRetry attempts=3); basketball_nba: 1 tentativa (sucesso)
    expect(seen.filter((s) => s === 'soccer_epl')).toHaveLength(3);
    expect(seen.filter((s) => s === 'basketball_nba')).toHaveLength(1);
    expect(result.requestsRemaining).toBe(300);
    expect(result.requestsUsed).toBe(200);

    const insertCall = calls.find((c) => c.table === 'arbs' && c.method === 'insert');
    expect(insertCall).toBeDefined();
  });
});
