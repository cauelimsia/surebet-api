try {
  process.loadEnvFile();
} catch {
  // .env opcional — produção pode injetar env vars direto
}

import { sendTelegramAlert } from './alert.js';
import { loadConfig } from './config.js';
import { createDb, upsertSports } from './db.js';
import { runCycle } from './loop.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  await upsertSports(db, config.sports);

  console.log(JSON.stringify({
    level: 'info', msg: 'worker iniciado',
    sports: config.sports, intervalo: config.pollIntervalSeconds, runOnce: config.runOnce,
  }));

  let consecutiveFullFailures = 0;
  let quotaBrakeActive = false;

  while (true) {
    const { failed, requestsRemaining } = await runCycle(db, config);

    if (failed === config.sports.length) {
      consecutiveFullFailures++;
    } else {
      consecutiveFullFailures = 0;
    }
    if (consecutiveFullFailures === 5) {
      await sendTelegramAlert(
        'surebet worker: 5 ciclos consecutivos falharam em todos os esportes',
        config.telegramBotToken,
        config.telegramChatId,
      );
    }

    let intervalSeconds = config.pollIntervalSeconds;
    const lowQuota =
      requestsRemaining !== null && requestsRemaining < config.monthlyQuota * 0.1;
    if (lowQuota) {
      intervalSeconds *= 4; // freio: 10% restantes da cota mensal
      if (!quotaBrakeActive) {
        quotaBrakeActive = true;
        await sendTelegramAlert(
          `surebet worker: cota baixa (${requestsRemaining} requests restantes) — polling reduzido 4x`,
          config.telegramBotToken,
          config.telegramChatId,
        );
      }
    } else {
      quotaBrakeActive = false;
    }

    if (config.runOnce) break;
    await sleep(intervalSeconds * 1000);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', err: String(err) }));
  process.exit(1);
});
