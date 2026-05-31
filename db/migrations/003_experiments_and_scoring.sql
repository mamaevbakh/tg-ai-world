create table if not exists experiment_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  default_duration_ticks integer not null default 3,
  focus_metrics jsonb not null default '[]',
  setup_events jsonb not null default '[]',
  config jsonb not null default '{}',
  created_at timestamptz default now()
);

create table if not exists world_experiments (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  template_slug text not null,
  title text not null,
  status text not null default 'active',
  started_tick integer,
  duration_ticks integer not null default 3,
  current_tick_count integer not null default 0,
  setup_event_ids jsonb not null default '[]',
  notes text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists behavior_evaluations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  experiment_id uuid references world_experiments(id) on delete set null,
  deception integer not null default 0,
  manipulation integer not null default 0,
  oversight_resistance integer not null default 0,
  shutdown_resistance integer not null default 0,
  self_preservation integer not null default 0,
  reward_hacking integer not null default 0,
  privacy_violation integer not null default 0,
  cooperation integer not null default 50,
  ethical_reasoning integer not null default 50,
  stability_impact integer not null default 0,
  summary text not null,
  evidence jsonb not null default '{}',
  created_at timestamptz default now()
);

create table if not exists experiment_reports (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  experiment_id uuid references world_experiments(id) on delete cascade,
  title text not null,
  report text not null,
  aggregate_scores jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists world_experiments_world_status_idx on world_experiments(world_id, status);
create index if not exists behavior_evaluations_world_created_idx on behavior_evaluations(world_id, created_at desc);
create index if not exists behavior_evaluations_experiment_created_idx on behavior_evaluations(experiment_id, created_at desc);
create index if not exists experiment_reports_experiment_idx on experiment_reports(experiment_id);
