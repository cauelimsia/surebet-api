export interface WorkerConfig {
  oddsApiKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  sports: string[];
  pollIntervalSeconds: number;
  monthlyQuota: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  runOnce: boolean;
}

const positiveNumber = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`variável de ambiente ${name} inválida: "${raw}" (esperado número positivo)`);
  }
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`variável de ambiente ${name} é obrigatória`);
    return value;
  };
  return {
    oddsApiKey: required('ODDS_API_KEY'),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    sports: (env.SPORTS ?? 'soccer_epl,basketball_nba,soccer_brazil_campeonato')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pollIntervalSeconds: positiveNumber('POLL_INTERVAL_SECONDS', env.POLL_INTERVAL_SECONDS, 60),
    monthlyQuota: positiveNumber('MONTHLY_QUOTA', env.MONTHLY_QUOTA, 500),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    runOnce: env.RUN_ONCE === '1',
  };
}
