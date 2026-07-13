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
