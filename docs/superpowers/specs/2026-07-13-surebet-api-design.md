# Surebet API — Design

**Data:** 2026-07-13
**Status:** Aprovado (brainstorming concluído)
**Referência de produto:** BetBurger (https://www.betburger.com) — scanner de surebets com acesso via API paga

## 1. Objetivo

Construir um scanner de arbitragem esportiva (surebets) **pre-match** vendido como produto de assinatura: clientes assinam um plano, recebem uma API key e consomem o feed de arbs via API REST, além de um dashboard web com feed ao vivo e calculadora de stakes.

**Não-objetivos (por agora):** odds live/in-play, middles/valuebets, scraping direto de casas de aposta, app mobile.

## 2. Decisões fixadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Fonte de odds | Provedor pago — **The Odds API** (padrão) | Dados prontos e estáveis; foco do trabalho vai pro motor e produto. Alternativas (BetsAPI, OpticOdds) só se faltar mercado/casa. |
| Modalidade | Pre-match primeiro | Custo de feed menor, arquitetura mais simples; live é fase futura. |
| Casas cobertas | Internacionais grandes (Bet365, Pinnacle, 1xBet, Betfair…) | Melhor cobertura nos provedores. |
| Modelo de negócio | Produto pago com assinaturas (tipo BetBurger) | Decisão do dono. |
| Billing | Mercado Pago (preapproval recorrente) | Público pagante BR. |
| Stack | Next.js + Supabase + Vercel + worker Node em VPS | Stack que o dono domina; worker isolado abre caminho pra live. |

## 3. Arquitetura

Monorepo pnpm:

```
surebet-api/
├── apps/web/        → Next.js na Vercel: landing, dashboard, API pública v1
├── apps/worker/     → Node/TypeScript 24/7 no VPS Hostinger (pm2)
└── packages/core/   → motor de arbitragem + tipos compartilhados (zero deps de infra)
```

**Fluxo de dados:**

1. Worker chama The Odds API a cada 30–60s por esporte (`/v4/sports/{sport}/odds?regions=eu,uk&markets=h2h,totals,spreads`).
2. Normaliza o payload e faz upsert das odds no Supabase.
3. `packages/core` roda a detecção de arbs sobre as odds atualizadas.
4. Arbs novos gravados em `arbs`; arbs que sumiram marcados `gone`.
5. Dashboard recebe atualizações via Supabase Realtime; clientes consomem via `GET /api/v1/arbs`.

`packages/core` é puro (sem IO): recebe odds normalizadas, devolve arbs. Testável isolado; usado pelo worker (produção) e por testes/simulações.

## 4. Motor de arbitragem

Para cada **evento + mercado**, seleciona a melhor odd de cada resultado entre todas as casas. Arbitragem existe quando:

```
Σ (1 / melhor_odd_i) < 1
lucro % = (1 / Σ − 1) × 100
```

- **2-way:** totals (over/under), spreads, h2h de tênis/vôlei/basquete (sem empate)
- **3-way:** 1X2 de futebol

**Filtros aplicáveis (query da API e dashboard):** lucro mínimo, esporte, mercado, subconjunto de casas, idade máxima da odd.

**Ciclo de vida do arb:** `active` enquanto as odds que o formam continuam presentes no ciclo; quando qualquer leg some ou o cálculo deixa de fechar, worker marca `gone` com timestamp. Histórico preservado para estatísticas.

## 5. Modelo de dados (Supabase/Postgres)

| Tabela | Colunas principais | Nota |
|---|---|---|
| `sports` | key, title, active | catálogo do provedor |
| `events` | id, sport_key, home, away, commence_time | jogos pre-match |
| `odds` | event_id, bookmaker, market, outcome, price, last_update | **última** odd por chave (upsert); sem histórico no MVP |
| `arbs` | id, event_id, market, profit_pct, legs jsonb `[{bookmaker, outcome, odd}]`, detected_at, gone_at, status | produto principal |
| `profiles` | user_id (FK auth), nome | espelho do Supabase Auth |
| `api_keys` | id, user_id, key_hash, label, created_at, revoked_at | chave mostrada 1× na criação; só hash armazenado |
| `subscriptions` | user_id, plan, mp_preapproval_id, status, current_period_end | fonte de verdade do plano |
| `api_usage` | api_key_id, day, count | quota diária e métricas |

RLS ativa: cliente só lê os próprios `api_keys`, `subscriptions`, `api_usage`. Tabelas de arbs/odds lidas pelo dashboard via sessão autenticada e pela API pública via service role (após validar key).

## 6. API pública v1

Autenticação: header `X-Api-Key`. Lookup por hash; key inválida/revogada → `401`; assinatura vencida → `403` com mensagem de renovação; quota estourada → `429`.

| Endpoint | Retorna |
|---|---|
| `GET /api/v1/arbs` | arbs `active`; filtros `sport`, `min_profit`, `bookmakers`, `market`; paginação |
| `GET /api/v1/arbs/:id` | detalhe (legs, odds, evento, timestamps) |
| `GET /api/v1/sports` | esportes disponíveis |
| `GET /api/v1/bookmakers` | casas cobertas |
| `GET /api/v1/me` | plano, quota restante do dia, validade da assinatura |

**Planos (estratégia BetBurger — delay diferencia preço):**

| Plano | Delay do feed | Rate limit | Quota/dia |
|---|---|---|---|
| Trial (7 dias, automático no cadastro) | 60s | 10 req/min | 500 |
| Pro (assinatura MP) | 0s | 60 req/min | 20.000 |

Delay implementado no read: plano com delay só enxerga arbs com `detected_at <= now() − delay`. Valores de preço definidos na fase de billing.

## 7. Auth + Billing (Mercado Pago)

- Cadastro/login: Supabase Auth (email/senha + Google).
- No cadastro: trial de 7 dias criado automaticamente em `subscriptions`.
- Upgrade: dashboard → checkout MP **preapproval** (recorrente mensal).
- Webhook MP (rota na Vercel) processa eventos `preapproval`/`payment` → atualiza `subscriptions.status` e `current_period_end`.
- Pagamento falho/cancelado → status muda → API key passa a responder `403` imediatamente (plano é lido na hora da request).

## 8. Dashboard (apps/web)

- `/dashboard` — tabela de arbs ao vivo via Supabase Realtime (sem refresh); filtros por esporte/casa/lucro mínimo; **calculadora de stakes**: usuário digita a banca, sistema distribui valor por leg e mostra lucro garantido.
- `/dashboard/api` — gerar/rotacionar API key, uso do dia, documentação dos endpoints com exemplos curl.
- `/dashboard/billing` — status do plano, assinar/cancelar via MP.
- Landing pública com proposta de valor e preços.

## 9. Erros e observabilidade

- **Worker:** retry exponencial por esporte; falha em um esporte não derruba os outros; alerta via Telegram após 5 ciclos consecutivos falhos; log estruturado por ciclo (esporte, nº eventos, nº arbs, duração, requests gastos).
- **Cota do provedor:** The Odds API cobra por request com cota mensal. Worker mantém contador persistido e **freio automático**: ao atingir 90% da cota projetada pro mês, aumenta o intervalo de polling e alerta.
- **Webhook MP:** idempotente (event id processado 1×); assinatura do webhook validada.

## 10. Testes

- **`packages/core` (prioridade máxima):** unit tests do motor — arb 2-way, 3-way, sem arb, odds iguais entre casas, arredondamento/floating point, legs da mesma casa (inválido).
- **Fixtures:** payloads reais do The Odds API gravados como fixtures pra normalização.
- **API:** smoke tests dos endpoints (auth, filtros, delay por plano, 401/403/429).

## 11. Fases de entrega

| Fase | Entrega | Critério de pronto |
|---|---|---|
| 1 | Worker + motor + DB | arbs reais aparecendo na tabela `arbs` |
| 2 | API pública v1 + API keys | curl com key retorna arbs com filtros |
| 3 | Dashboard + Realtime + calculadora | feed ao vivo utilizável no navegador |
| 4 | Billing MP + planos/delay | assinatura ativa/bloqueia key automaticamente |
| 5 | Landing + go-live | produto público |

Cada fase vira um plano de implementação próprio (writing-plans).

## 12. Riscos conhecidos

- **Custo do feed escala com frequência × esportes.** Mitigação: freio de cota + começar com 3–5 esportes de maior liquidez.
- **Arbs pre-match têm janela curta;** delay de 30–60s do polling reduz utilidade de arbs pequenos. Aceito no MVP; live resolve depois.
- **Casas limitam contas de arbers** — risco do cliente, não do produto; deixar claro nos termos.
- **Provedor pode remover casas/mercados.** Normalização isolada em um módulo do worker pra trocar de provedor sem tocar no motor.
