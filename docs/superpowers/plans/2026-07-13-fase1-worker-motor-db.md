# Fase 1 — Worker + Motor de Arbitragem + DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker Node 24/7 que busca odds pre-match no The Odds API, detecta surebets e mantém a tabela `arbs` do Supabase atualizada (critério de pronto da Fase 1 do spec).

**Architecture:** Monorepo pnpm. `packages/core` contém o motor de arbitragem puro (sem IO). `apps/worker` orquestra: fetch → normalize → upsert odds → computeArbs → sync de arbs (insert novos / refresh ativos / marcar gone). Supabase Postgres com 4 tabelas (`sports`, `events`, `odds`, `arbs`).

**Tech Stack:** Node ≥ 22 (fetch nativo), TypeScript ESM (NodeNext), pnpm workspaces, Vitest, @supabase/supabase-js, tsx (dev), pm2 (deploy VPS).

**Spec:** `docs/superpowers/specs/2026-07-13-surebet-api-design.md`

## Global Constraints

- Node ≥ 22; ESM em tudo (`"type": "module"`); imports relativos com extensão `.js`.
- `packages/core` NÃO importa supabase, fetch nem env — funções puras somente.
- Nomes de pacote: `@surebet/core`, `@surebet/worker`.
- Odds sempre em formato decimal. Lucro: `profit_pct = (1/Σ(1/odd) − 1) × 100`, arredondado a 4 casas.
- `arb_key = eventId|market|lineKey`, onde `lineKey = |point|` para spreads e `point` para o resto (h2h usa 0).
- Máquina pode ter App Control bloqueando binários nativos (já aconteceu com swc). Se `vitest`/`tsx` falharem por bloqueio do esbuild, fallback: compilar com `tsc` e rodar testes com `node --test` sobre o JS compilado — mesma estrutura de asserts via `node:assert`.
- Idioma de mensagens de log/alerta: português. Código (identificadores) em inglês.

## Pré-requisitos (ações do dono antes/durante execução)

1. **The Odds API key:** criar conta em https://the-odds-api.com (free tier = 500 credits/mês — suficiente pra dev com `RUN_ONCE=1`; produção contínua exige plano pago; 3 esportes a cada 60s ≈ 130k requests/mês).
2. **Projeto Supabase:** criar via MCP Supabase (`list_organizations` → `create_project`) ou dashboard. Guardar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

---

### Task 1: Scaffold do monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`

**Interfaces:**
- Consumes: nada (primeiro task)
- Produces: workspaces `@surebet/core` e `@surebet/worker` instaláveis; scripts `pnpm -r test`, `pnpm -r typecheck` funcionando (vazios ainda)

- [ ] **Step 1: Criar arquivos raiz**

`package.json`:
```json
{
  "name": "surebet-api",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
```

- [ ] **Step 2: Criar packages/core**

`packages/core/package.json`:
```json
{
  "name": "@surebet/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Criar apps/worker**

`apps/worker/package.json`:
```json
{
  "name": "@surebet/worker",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@surebet/core": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 4: Instalar e verificar**

Run: `pnpm install` (na raiz `C:\Users\canva\surebet-api`)
Expected: lockfile criado, sem erros. (`pnpm -r test` ainda falha — sem testes — ok.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo pnpm (core + worker)"
```

---

### Task 2: Motor de arbitragem (`packages/core`)

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/arbitrage.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/arbitrage.test.ts`

**Interfaces:**
- Consumes: nada
- Produces (usado pelo worker):
  - `interface NormalizedOdd { eventId; sportKey; homeTeam; awayTeam; commenceTime; bookmaker; market; outcome; point; price; lastUpdate }` (strings exceto `point`/`price` number)
  - `interface ArbLeg { bookmaker: string; outcome: string; price: number }`
  - `interface Arb { arbKey: string; eventId: string; market: string; point: number; profitPct: number; legs: ArbLeg[] }`
  - `function computeArbs(odds: NormalizedOdd[]): Arb[]`

- [ ] **Step 1: Escrever os testes (falhando)**

`packages/core/test/arbitrage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeArbs, type NormalizedOdd } from '../src/index.js';

function makeOdd(partial: Partial<NormalizedOdd>): NormalizedOdd {
  return {
    eventId: 'ev1',
    sportKey: 'basketball_nba',
    homeTeam: 'Lakers',
    awayTeam: 'Celtics',
    commenceTime: '2026-07-14T00:00:00Z',
    bookmaker: 'bookA',
    market: 'h2h',
    outcome: 'Lakers',
    point: 0,
    price: 2.0,
    lastUpdate: '2026-07-13T12:00:00Z',
    ...partial,
  };
}

describe('computeArbs', () => {
  it('detecta arb 2-way em totals com lucro correto', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 210.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 210.5, price: 2.1, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeCloseTo(5.0, 4);
    expect(arbs[0].arbKey).toBe('ev1|totals|210.5');
    expect(arbs[0].legs).toHaveLength(2);
  });

  it('detecta arb 3-way em h2h de futebol', () => {
    const soccer = { sportKey: 'soccer_epl', market: 'h2h' };
    const odds = [
      makeOdd({ ...soccer, outcome: 'Home', price: 3.9, bookmaker: 'bookA' }),
      makeOdd({ ...soccer, outcome: 'Draw', price: 4.0, bookmaker: 'bookB' }),
      makeOdd({ ...soccer, outcome: 'Away', price: 2.2, bookmaker: 'bookC' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeCloseTo(4.063, 2);
    expect(arbs[0].legs).toHaveLength(3);
  });

  it('não reporta arb quando soma dos inversos >= 1', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 1.9, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 1.9, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('escolhe a melhor odd de cada resultado entre as casas', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 1.8, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    const over = arbs[0].legs.find((l) => l.outcome === 'Over');
    expect(over?.bookmaker).toBe('bookB');
    expect(over?.price).toBe(2.1);
  });

  it('descarta arb com todas as legs na mesma casa', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('descarta h2h de futebol sem o empate cotado (falso 2-way)', () => {
    const soccer = { sportKey: 'soccer_epl', market: 'h2h' };
    const odds = [
      makeOdd({ ...soccer, outcome: 'Home', price: 2.2, bookmaker: 'bookA' }),
      makeOdd({ ...soccer, outcome: 'Away', price: 2.2, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('agrupa spreads pelo valor absoluto do point (linhas espelhadas)', () => {
    const odds = [
      makeOdd({ market: 'spreads', outcome: 'Lakers', point: -1.5, price: 2.05, bookmaker: 'bookA' }),
      makeOdd({ market: 'spreads', outcome: 'Celtics', point: 1.5, price: 2.05, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].arbKey).toBe('ev1|spreads|1.5');
  });

  it('não mistura linhas diferentes de totals', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.5, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 3.5, price: 2.5, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('ignora grupo com um único resultado cotado', () => {
    const odds = [makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 3.0 })];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('eventos diferentes não se misturam', () => {
    const odds = [
      makeOdd({ eventId: 'ev1', market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ eventId: 'ev2', market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @surebet/core test`
Expected: FAIL — `Cannot find module '../src/index.js'` (ou similar).

- [ ] **Step 3: Implementar**

`packages/core/src/types.ts`:
```ts
export interface NormalizedOdd {
  eventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmaker: string;
  market: string;
  outcome: string;
  point: number;
  price: number;
  lastUpdate: string;
}

export interface ArbLeg {
  bookmaker: string;
  outcome: string;
  price: number;
}

export interface Arb {
  arbKey: string;
  eventId: string;
  market: string;
  point: number;
  profitPct: number;
  legs: ArbLeg[];
}
```

`packages/core/src/arbitrage.ts`:
```ts
import type { Arb, ArbLeg, NormalizedOdd } from './types.js';

function lineKey(market: string, point: number): number {
  return market === 'spreads' ? Math.abs(point) : point;
}

export function computeArbs(odds: NormalizedOdd[]): Arb[] {
  const groups = new Map<string, NormalizedOdd[]>();
  for (const odd of odds) {
    const key = `${odd.eventId}|${odd.market}|${lineKey(odd.market, odd.point)}`;
    const list = groups.get(key) ?? [];
    list.push(odd);
    groups.set(key, list);
  }

  const arbs: Arb[] = [];
  for (const [key, group] of groups) {
    const arb = detectArb(key, group);
    if (arb) arbs.push(arb);
  }
  return arbs;
}

function detectArb(arbKey: string, group: NormalizedOdd[]): Arb | null {
  // o conjunto esperado de resultados vem da casa que cota o mercado mais completo
  const byBookmaker = new Map<string, Set<string>>();
  for (const odd of group) {
    const set = byBookmaker.get(odd.bookmaker) ?? new Set<string>();
    set.add(odd.outcome);
    byBookmaker.set(odd.bookmaker, set);
  }
  let expected: Set<string> | null = null;
  for (const set of byBookmaker.values()) {
    if (!expected || set.size > expected.size) expected = set;
  }
  if (!expected || expected.size < 2) return null;

  const first = group[0];
  // h2h de futebol é 3-way; sem o empate cotado a conta fecharia um falso arb
  if (first.market === 'h2h' && first.sportKey.startsWith('soccer') && expected.size < 3) {
    return null;
  }

  const best = new Map<string, ArbLeg>();
  for (const odd of group) {
    if (!expected.has(odd.outcome)) continue;
    const current = best.get(odd.outcome);
    if (!current || odd.price > current.price) {
      best.set(odd.outcome, { bookmaker: odd.bookmaker, outcome: odd.outcome, price: odd.price });
    }
  }
  if (best.size !== expected.size) return null;

  const legs = [...best.values()];
  if (new Set(legs.map((leg) => leg.bookmaker)).size < 2) return null;

  const sum = legs.reduce((acc, leg) => acc + 1 / leg.price, 0);
  if (sum >= 1) return null;

  return {
    arbKey,
    eventId: first.eventId,
    market: first.market,
    point: lineKey(first.market, first.point),
    profitPct: Math.round((1 / sum - 1) * 100 * 10000) / 10000,
    legs,
  };
}
```

`packages/core/src/index.ts`:
```ts
export type { Arb, ArbLeg, NormalizedOdd } from './types.js';
export { computeArbs } from './arbitrage.js';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @surebet/core test`
Expected: PASS — 10 testes.

- [ ] **Step 5: Typecheck e commit**

Run: `pnpm --filter @surebet/core typecheck`
Expected: sem erros.

```bash
git add packages/core
git commit -m "feat(core): motor de arbitragem com deteccao 2-way/3-way"
```

---

### Task 3: Schema do banco (Supabase)

**Files:**
- Create: `supabase/migrations/0001_phase1_schema.sql`

**Interfaces:**
- Consumes: projeto Supabase existente (pré-requisito 2)
- Produces: tabelas `sports`, `events`, `odds`, `arbs` no Postgres — nomes de coluna exatos usados pelo `db.ts` da Task 6

- [ ] **Step 1: Escrever a migration**

`supabase/migrations/0001_phase1_schema.sql`:
```sql
create table sports (
  key text primary key,
  title text not null,
  active boolean not null default true
);

create table events (
  id text primary key,
  sport_key text not null references sports(key),
  home_team text not null,
  away_team text not null,
  commence_time timestamptz not null
);

create table odds (
  event_id text not null references events(id) on delete cascade,
  bookmaker text not null,
  market text not null,
  outcome text not null,
  point numeric not null default 0,
  price numeric not null,
  last_update timestamptz not null,
  primary key (event_id, bookmaker, market, outcome, point)
);

create table arbs (
  id uuid primary key default gen_random_uuid(),
  arb_key text not null,
  event_id text not null references events(id) on delete cascade,
  market text not null,
  point numeric not null default 0,
  profit_pct numeric not null,
  legs jsonb not null,
  status text not null default 'active' check (status in ('active', 'gone')),
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  gone_at timestamptz
);

create index events_sport_idx on events (sport_key);
create index odds_event_idx on odds (event_id);
create index arbs_status_idx on arbs (status);
create unique index arbs_arb_key_active_idx on arbs (arb_key) where status = 'active';

-- Fase 1: RLS ligada sem policies — só o worker (service role, bypassa RLS) acessa.
-- Policies de leitura entram na Fase 2/3 junto com API e dashboard.
alter table sports enable row level security;
alter table events enable row level security;
alter table odds enable row level security;
alter table arbs enable row level security;
```

- [ ] **Step 2: Aplicar no Supabase**

Via MCP Supabase: `apply_migration` com nome `phase1_schema` e o SQL acima (no projeto criado no pré-requisito).
Expected: sucesso sem erro.

- [ ] **Step 3: Verificar tabelas**

Via MCP Supabase: `list_tables`.
Expected: `sports`, `events`, `odds`, `arbs` presentes com as colunas acima.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_phase1_schema.sql
git commit -m "feat(db): schema fase 1 (sports, events, odds, arbs)"
```

---

### Task 4: Config + cliente The Odds API

**Files:**
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/odds-api.ts`
- Test: `apps/worker/test/odds-api.test.ts`

**Interfaces:**
- Consumes: nada dos tasks anteriores
- Produces:
  - `interface WorkerConfig { oddsApiKey: string; supabaseUrl: string; supabaseServiceRoleKey: string; sports: string[]; pollIntervalSeconds: number; monthlyQuota: number; telegramBotToken?: string; telegramChatId?: string; runOnce: boolean }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): WorkerConfig`
  - `interface OddsApiEvent { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string; bookmakers: OddsApiBookmaker[] }` (com `OddsApiBookmaker { key; title; last_update; markets: { key; last_update; outcomes: { name; price; point? }[] }[] }`)
  - `interface FetchOddsResult { events: OddsApiEvent[]; requestsRemaining: number | null; requestsUsed: number | null }`
  - `function fetchOdds(sportKey: string, apiKey: string, fetchFn?: typeof fetch): Promise<FetchOddsResult>`

- [ ] **Step 1: Escrever teste do cliente (falhando)**

`apps/worker/test/odds-api.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fetchOdds } from '../src/odds-api.js';

describe('fetchOdds', () => {
  it('monta a URL com sport, mercados e formato decimal e lê headers de quota', async () => {
    let calledUrl = '';
    const fakeFetch = (async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-requests-remaining': '450', 'x-requests-used': '50' },
      });
    }) as typeof fetch;

    const result = await fetchOdds('soccer_epl', 'test-key', fakeFetch);

    expect(calledUrl).toContain('/v4/sports/soccer_epl/odds');
    expect(calledUrl).toContain('apiKey=test-key');
    expect(calledUrl).toContain('regions=eu%2Cuk');
    expect(calledUrl).toContain('markets=h2h%2Ctotals%2Cspreads');
    expect(calledUrl).toContain('oddsFormat=decimal');
    expect(result.events).toEqual([]);
    expect(result.requestsRemaining).toBe(450);
    expect(result.requestsUsed).toBe(50);
  });

  it('lança erro com status em resposta não-ok', async () => {
    const fakeFetch = (async () =>
      new Response('Invalid API key', { status: 401 })) as typeof fetch;
    await expect(fetchOdds('soccer_epl', 'bad', fakeFetch)).rejects.toThrow('401');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @surebet/worker test`
Expected: FAIL — módulo `../src/odds-api.js` não existe.

- [ ] **Step 3: Implementar config e cliente**

`apps/worker/src/config.ts`:
```ts
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
    pollIntervalSeconds: Number(env.POLL_INTERVAL_SECONDS ?? 60),
    monthlyQuota: Number(env.MONTHLY_QUOTA ?? 500),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    runOnce: env.RUN_ONCE === '1',
  };
}
```

`apps/worker/src/odds-api.ts`:
```ts
export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface FetchOddsResult {
  events: OddsApiEvent[];
  requestsRemaining: number | null;
  requestsUsed: number | null;
}

export async function fetchOdds(
  sportKey: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchOddsResult> {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', 'eu,uk');
  url.searchParams.set('markets', 'h2h,totals,spreads');
  url.searchParams.set('oddsFormat', 'decimal');

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    throw new Error(`odds api ${res.status}: ${await res.text()}`);
  }
  const events = (await res.json()) as OddsApiEvent[];
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  return {
    events,
    requestsRemaining: remaining === null ? null : Number(remaining),
    requestsUsed: used === null ? null : Number(used),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @surebet/worker test`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/config.ts apps/worker/src/odds-api.ts apps/worker/test/odds-api.test.ts
git commit -m "feat(worker): config por env e cliente The Odds API com quota headers"
```

---

### Task 5: Normalização do payload

**Files:**
- Create: `apps/worker/src/normalize.ts`
- Create: `apps/worker/test/fixtures/odds-api-soccer.json`
- Test: `apps/worker/test/normalize.test.ts`

**Interfaces:**
- Consumes: `OddsApiEvent` (Task 4), `NormalizedOdd` (Task 2)
- Produces: `function normalizeEvents(events: OddsApiEvent[]): NormalizedOdd[]`

- [ ] **Step 1: Criar fixture com payload real do The Odds API**

`apps/worker/test/fixtures/odds-api-soccer.json`:
```json
[
  {
    "id": "e912304de2b2ce35b473ce2ecd3d1502",
    "sport_key": "soccer_epl",
    "sport_title": "EPL",
    "commence_time": "2026-07-14T19:00:00Z",
    "home_team": "Arsenal",
    "away_team": "Chelsea",
    "bookmakers": [
      {
        "key": "pinnacle",
        "title": "Pinnacle",
        "last_update": "2026-07-13T12:00:00Z",
        "markets": [
          {
            "key": "h2h",
            "last_update": "2026-07-13T12:00:00Z",
            "outcomes": [
              { "name": "Arsenal", "price": 2.5 },
              { "name": "Chelsea", "price": 3.1 },
              { "name": "Draw", "price": 3.4 }
            ]
          },
          {
            "key": "totals",
            "last_update": "2026-07-13T12:00:00Z",
            "outcomes": [
              { "name": "Over", "price": 1.95, "point": 2.5 },
              { "name": "Under", "price": 1.95, "point": 2.5 }
            ]
          }
        ]
      },
      {
        "key": "onexbet",
        "title": "1xBet",
        "last_update": "2026-07-13T12:00:10Z",
        "markets": [
          {
            "key": "h2h",
            "last_update": "2026-07-13T12:00:10Z",
            "outcomes": [
              { "name": "Arsenal", "price": 2.6 },
              { "name": "Chelsea", "price": 3.0 },
              { "name": "Draw", "price": 3.5 }
            ]
          }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: Escrever teste (falhando)**

`apps/worker/test/normalize.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OddsApiEvent } from '../src/odds-api.js';
import { normalizeEvents } from '../src/normalize.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'odds-api-soccer.json'), 'utf8'),
) as OddsApiEvent[];

describe('normalizeEvents', () => {
  it('achata eventos em uma linha por odd', () => {
    const rows = normalizeEvents(fixture);
    // pinnacle: 3 h2h + 2 totals; onexbet: 3 h2h = 8
    expect(rows).toHaveLength(8);
  });

  it('preenche campos do evento, casa e mercado', () => {
    const rows = normalizeEvents(fixture);
    const over = rows.find((r) => r.outcome === 'Over');
    expect(over).toMatchObject({
      eventId: 'e912304de2b2ce35b473ce2ecd3d1502',
      sportKey: 'soccer_epl',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      bookmaker: 'pinnacle',
      market: 'totals',
      point: 2.5,
      price: 1.95,
    });
  });

  it('usa point 0 quando o outcome não tem point (h2h)', () => {
    const rows = normalizeEvents(fixture);
    const h2h = rows.find((r) => r.market === 'h2h');
    expect(h2h?.point).toBe(0);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @surebet/worker test`
Expected: FAIL — `../src/normalize.js` não existe.

- [ ] **Step 4: Implementar**

`apps/worker/src/normalize.ts`:
```ts
import type { NormalizedOdd } from '@surebet/core';
import type { OddsApiEvent } from './odds-api.js';

export function normalizeEvents(events: OddsApiEvent[]): NormalizedOdd[] {
  const rows: NormalizedOdd[] = [];
  for (const event of events) {
    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        for (const outcome of market.outcomes) {
          rows.push({
            eventId: event.id,
            sportKey: event.sport_key,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            commenceTime: event.commence_time,
            bookmaker: bookmaker.key,
            market: market.key,
            outcome: outcome.name,
            point: outcome.point ?? 0,
            price: outcome.price,
            lastUpdate: market.last_update,
          });
        }
      }
    }
  }
  return rows;
}
```

Nota: `@surebet/core` precisa estar buildado pro worker resolver tipos — rodar `pnpm --filter @surebet/core build` antes do typecheck se necessário.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @surebet/core build && pnpm --filter @surebet/worker test`
Expected: PASS — 5 testes (2 do odds-api + 3 do normalize).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/normalize.ts apps/worker/test/normalize.test.ts apps/worker/test/fixtures/odds-api-soccer.json
git commit -m "feat(worker): normalizacao do payload do The Odds API"
```

---

### Task 6: Sync de arbs — diff puro + camada de banco

**Files:**
- Create: `apps/worker/src/arb-sync.ts`
- Create: `apps/worker/src/db.ts`
- Test: `apps/worker/test/arb-sync.test.ts`

**Interfaces:**
- Consumes: `Arb`, `NormalizedOdd` (Task 2); tabelas da Task 3
- Produces:
  - `interface ActiveArbRef { id: string; arbKey: string }`
  - `interface ArbSyncPlan { inserts: Arb[]; updates: { id: string; arb: Arb }[]; goneIds: string[] }`
  - `function planArbSync(current: Arb[], active: ActiveArbRef[]): ArbSyncPlan`
  - `function createDb(url: string, serviceRoleKey: string): SupabaseClient`
  - `async function upsertSports(db, sportKeys: string[]): Promise<void>`
  - `async function upsertEventsAndOdds(db, odds: NormalizedOdd[]): Promise<void>`
  - `async function getActiveArbRefs(db, sportKey: string): Promise<ActiveArbRef[]>`
  - `async function applyArbSync(db, plan: ArbSyncPlan): Promise<void>`

- [ ] **Step 1: Escrever teste do diff (falhando)**

`apps/worker/test/arb-sync.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Arb } from '@surebet/core';
import { planArbSync } from '../src/arb-sync.js';

function makeArb(arbKey: string): Arb {
  return {
    arbKey,
    eventId: arbKey.split('|')[0],
    market: 'totals',
    point: 2.5,
    profitPct: 3.5,
    legs: [
      { bookmaker: 'bookA', outcome: 'Over', price: 2.1 },
      { bookmaker: 'bookB', outcome: 'Under', price: 2.1 },
    ],
  };
}

describe('planArbSync', () => {
  it('arb novo vira insert', () => {
    const plan = planArbSync([makeArb('ev1|totals|2.5')], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.goneIds).toHaveLength(0);
  });

  it('arb já ativo vira update com o id existente', () => {
    const plan = planArbSync(
      [makeArb('ev1|totals|2.5')],
      [{ id: 'row-1', arbKey: 'ev1|totals|2.5' }],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: 'row-1', arb: makeArb('ev1|totals|2.5') }]);
    expect(plan.goneIds).toHaveLength(0);
  });

  it('arb ativo que sumiu vira gone', () => {
    const plan = planArbSync([], [{ id: 'row-1', arbKey: 'ev1|totals|2.5' }]);
    expect(plan.goneIds).toEqual(['row-1']);
  });

  it('mistura: 1 novo, 1 refresh, 1 gone', () => {
    const plan = planArbSync(
      [makeArb('ev1|totals|2.5'), makeArb('ev2|h2h|0')],
      [
        { id: 'row-1', arbKey: 'ev1|totals|2.5' },
        { id: 'row-2', arbKey: 'ev3|spreads|1.5' },
      ],
    );
    expect(plan.inserts.map((a) => a.arbKey)).toEqual(['ev2|h2h|0']);
    expect(plan.updates.map((u) => u.id)).toEqual(['row-1']);
    expect(plan.goneIds).toEqual(['row-2']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @surebet/worker test`
Expected: FAIL — `../src/arb-sync.js` não existe.

- [ ] **Step 3: Implementar diff + db**

`apps/worker/src/arb-sync.ts`:
```ts
import type { Arb } from '@surebet/core';

export interface ActiveArbRef {
  id: string;
  arbKey: string;
}

export interface ArbSyncPlan {
  inserts: Arb[];
  updates: { id: string; arb: Arb }[];
  goneIds: string[];
}

export function planArbSync(current: Arb[], active: ActiveArbRef[]): ArbSyncPlan {
  const activeByKey = new Map(active.map((a) => [a.arbKey, a.id]));
  const currentKeys = new Set(current.map((a) => a.arbKey));

  const inserts: Arb[] = [];
  const updates: { id: string; arb: Arb }[] = [];
  for (const arb of current) {
    const id = activeByKey.get(arb.arbKey);
    if (id) {
      updates.push({ id, arb });
    } else {
      inserts.push(arb);
    }
  }
  const goneIds = active.filter((a) => !currentKeys.has(a.arbKey)).map((a) => a.id);
  return { inserts, updates, goneIds };
}
```

`apps/worker/src/db.ts`:
```ts
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
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `pnpm --filter @surebet/worker test && pnpm --filter @surebet/worker typecheck`
Expected: PASS — 9 testes no worker; typecheck limpo (db.ts não tem unit test — é IO fino, verificado no smoke da Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/arb-sync.ts apps/worker/src/db.ts apps/worker/test/arb-sync.test.ts
git commit -m "feat(worker): diff de arbs e camada supabase (insert/refresh/gone)"
```

---

### Task 7: Alertas Telegram + loop de ciclo

**Files:**
- Create: `apps/worker/src/alert.ts`
- Create: `apps/worker/src/loop.ts`
- Test: `apps/worker/test/loop.test.ts`

**Interfaces:**
- Consumes: tudo dos tasks 2, 4, 5, 6
- Produces:
  - `async function sendTelegramAlert(message: string, botToken?: string, chatId?: string, fetchFn?: typeof fetch): Promise<void>`
  - `async function withRetry<T>(fn: () => Promise<T>, attempts: number, sleepFn?: (ms: number) => Promise<void>): Promise<T>`
  - `async function runCycle(db, config, deps?): Promise<{ failed: number; requestsRemaining: number | null }>` — usada pelo `index.ts` (Task 8)

- [ ] **Step 1: Escrever teste do retry (falhando)**

`apps/worker/test/loop.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { withRetry } from '../src/loop.js';

const noSleep = async (): Promise<void> => {};

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @surebet/worker test`
Expected: FAIL — `../src/loop.js` não existe.

- [ ] **Step 3: Implementar alert e loop**

`apps/worker/src/alert.ts`:
```ts
export async function sendTelegramAlert(
  message: string,
  botToken?: string,
  chatId?: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!botToken || !chatId) return;
  try {
    await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (err) {
    // alerta nunca derruba o worker, mas a falha fica registrada
    console.error(JSON.stringify({ level: 'error', msg: 'falha ao enviar alerta telegram', err: String(err) }));
  }
}
```

`apps/worker/src/loop.ts`:
```ts
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
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `pnpm --filter @surebet/worker test && pnpm --filter @surebet/worker typecheck`
Expected: PASS — 12 testes no worker; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/alert.ts apps/worker/src/loop.ts apps/worker/test/loop.test.ts
git commit -m "feat(worker): ciclo de coleta com retry e alerta telegram"
```

---

### Task 8: Entry point, freio de quota, pm2 e smoke test

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/ecosystem.config.cjs`
- Create: `apps/worker/.env.example`
- Create: `README.md`

**Interfaces:**
- Consumes: `loadConfig` (Task 4), `createDb`/`upsertSports` (Task 6), `runCycle` (Task 7), `sendTelegramAlert` (Task 7)
- Produces: worker executável (`pnpm --filter @surebet/worker dev` com `RUN_ONCE=1`), deploy pm2 documentado

- [ ] **Step 1: Implementar entry point**

`apps/worker/src/index.ts`:
```ts
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
```

- [ ] **Step 2: Criar pm2 config e .env.example**

`apps/worker/ecosystem.config.cjs`:
```js
module.exports = {
  apps: [
    {
      name: 'surebet-worker',
      script: 'dist/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
```

`apps/worker/.env.example`:
```
ODDS_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SPORTS=soccer_epl,basketball_nba,soccer_brazil_campeonato
POLL_INTERVAL_SECONDS=60
MONTHLY_QUOTA=500
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
RUN_ONCE=
```

- [ ] **Step 3: Criar README**

`README.md`:
```markdown
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
3. Env vars via `.env` no diretório do worker (pm2 herda) ou `pm2 set`

## Testes

`pnpm test` roda vitest em todos os pacotes.
```

- [ ] **Step 4: Build completo e typecheck**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: build dos 2 pacotes ok, typecheck limpo, 22 testes passando (10 core + 12 worker).

- [ ] **Step 5: Smoke test com serviços reais**

Pré-requisito: `.env` preenchido com `ODDS_API_KEY` e credenciais do Supabase (pré-requisitos 1 e 2).

Run (PowerShell): `$env:RUN_ONCE='1'; pnpm --filter @surebet/worker dev`
Expected: logs JSON com `events > 0` e `oddsRows > 0` pra pelo menos 1 esporte; sem `level:error` de banco.

Verificar no Supabase (MCP `execute_sql`):
```sql
select count(*) from events;
select count(*) from odds;
select count(*), status from arbs group by status;
```
Expected: `events` e `odds` > 0. `arbs` pode ser 0 (arb real é raro em janela única — o critério é o pipeline rodar sem erro; arbs aparecem com o worker contínuo).

- [ ] **Step 6: Commit final da fase**

```bash
git add -A
git commit -m "feat(worker): entry point com freio de quota, pm2 e docs de deploy"
```

---

## Fora de escopo desta fase

API pública, API keys, dashboard, billing MP, landing — fases 2–5 do spec, cada uma com plano próprio.
