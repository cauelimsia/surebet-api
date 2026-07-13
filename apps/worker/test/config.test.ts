import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('retorna defaults (sports de 3 items, pollIntervalSeconds 60, monthlyQuota 500, runOnce false) com apenas vars obrigatórias', () => {
    const env = {
      ODDS_API_KEY: 'x',
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
    };

    const config = loadConfig(env);

    expect(config.oddsApiKey).toBe('x');
    expect(config.supabaseUrl).toBe('x');
    expect(config.supabaseServiceRoleKey).toBe('x');
    expect(config.sports).toHaveLength(3);
    expect(config.sports).toContain('soccer_epl');
    expect(config.sports).toContain('basketball_nba');
    expect(config.sports).toContain('soccer_brazil_campeonato');
    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.monthlyQuota).toBe(500);
    expect(config.runOnce).toBe(false);
  });

  it('lança erro mencionando POLL_INTERVAL_SECONDS quando POLL_INTERVAL_SECONDS="60s"', () => {
    const env = {
      ODDS_API_KEY: 'x',
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      POLL_INTERVAL_SECONDS: '60s',
    };

    expect(() => loadConfig(env)).toThrow('POLL_INTERVAL_SECONDS');
  });

  it('lança erro quando var obrigatória está faltando', () => {
    const env = {
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
    };

    expect(() => loadConfig(env)).toThrow('ODDS_API_KEY');
  });
});
