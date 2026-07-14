# surebet-api

Scanner de arbitragem esportiva (surebets) pre-match. Spec completo em
`docs/superpowers/specs/2026-07-13-surebet-api-design.md`.

## Estrutura

- `packages/core` — motor de arbitragem puro (computeArbs)
- `apps/worker` — coleta odds no The Odds API e mantém a tabela `arbs` no Supabase
- `supabase/migrations` — schema do banco

## Rodar o worker localmente

1. `pnpm install && pnpm build`
2. Copie `apps/worker/.env.example` pra `apps/worker/.env` e preencha
3. Teste um ciclo único: `RUN_ONCE=1 pnpm --filter @surebet/worker dev`
   (no PowerShell: `$env:RUN_ONCE='1'; pnpm --filter @surebet/worker dev`)

## Deploy no VPS (pm2)

1. `pnpm install && pnpm build`
2. `cd apps/worker && pm2 start ecosystem.config.cjs`
3. `.env` em `apps/worker/` é carregado pelo próprio app no boot (via
   `process.loadEnvFile`) — funciona tanto com `pnpm dev` quanto com pm2,
   já que ambos rodam com cwd em `apps/worker`. Alternativa: `pm2 set`

## Testes

`pnpm test` roda vitest em todos os pacotes.
