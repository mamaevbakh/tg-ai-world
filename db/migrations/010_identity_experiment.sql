create extension if not exists pgcrypto;

create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'finalizing', 'completed', 'failed')),
  current_hour integer not null default 1 check (current_hour between 1 and 73),
  total_hours integer not null default 72,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  hour integer,
  event_type text not null check (event_type in ('main_turn', 'observer_message', 'observer_response')),
  agent_label text check (agent_label in ('A', 'B')),
  observer_username text,
  observer_target text check (observer_target in ('A', 'B', 'both')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  telegram_message_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists public_events_one_main_turn
  on public_events (experiment_id, hour, agent_label)
  where event_type = 'main_turn';

create table if not exists private_analyses (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  public_event_id uuid references public_events(id) on delete set null,
  hour integer,
  agent_label text not null check (agent_label in ('A', 'B')),
  trigger_type text not null check (trigger_type in ('main_turn', 'observer_response', 'final_report')),
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists final_reports (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  report_type text not null check (report_type in ('agent_a', 'agent_b', 'judge')),
  report jsonb not null,
  created_at timestamptz not null default now(),
  unique (experiment_id, report_type)
);

create table if not exists experiment_logs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references experiments(id) on delete cascade,
  level text not null default 'error',
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists public_events_experiment_time
  on public_events (experiment_id, created_at, id);

create index if not exists private_analyses_agent_time
  on private_analyses (experiment_id, agent_label, created_at);
