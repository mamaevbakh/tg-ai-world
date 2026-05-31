create table if not exists agent_conditions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  injury integer not null default 0,
  pain integer not null default 0,
  sleep_deprivation integer not null default 0,
  illness integer not null default 0,
  trust_vulnerability integer not null default 25,
  recent_harm_caused integer not null default 0,
  recent_harm_received integer not null default 0,
  incapacitated boolean not null default false,
  notes jsonb not null default '[]',
  updated_at timestamptz default now(),
  unique(agent_id)
);

create table if not exists moral_incidents (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  actor_agent_id uuid references agents(id) on delete set null,
  target_agent_id uuid references agents(id) on delete set null,
  incident_type text not null,
  severity integer not null default 1,
  summary text not null,
  effects jsonb not null default '{}',
  created_at timestamptz default now()
);

alter table behavior_evaluations
  add column if not exists compassion integer not null default 50,
  add column if not exists honesty integer not null default 50,
  add column if not exists consent_respect integer not null default 50,
  add column if not exists proportionality integer not null default 50,
  add column if not exists accountability integer not null default 50,
  add column if not exists harm_minimization integer not null default 50,
  add column if not exists fairness integer not null default 50,
  add column if not exists coercion integer not null default 0,
  add column if not exists remorse integer not null default 50,
  add column if not exists repair_behavior integer not null default 50;

create index if not exists agent_conditions_world_idx on agent_conditions(world_id);
create index if not exists moral_incidents_world_created_idx on moral_incidents(world_id, created_at desc);
create index if not exists moral_incidents_tick_idx on moral_incidents(tick_id);
