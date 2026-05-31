create table if not exists agent_observations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  observation_type text not null,
  subject text not null,
  content text not null,
  confidence integer not null default 70,
  importance integer not null default 5,
  emotional_valence integer not null default 0,
  visibility text not null default 'private_to_agent',
  created_at timestamptz default now()
);

create table if not exists agent_perception_summaries (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  summary text not null,
  subjects jsonb not null default '[]',
  source_observation_ids jsonb not null default '[]',
  created_at timestamptz default now()
);

alter table if exists agent_actions
  add column if not exists observation_ids jsonb not null default '[]',
  add column if not exists affected_agent_ids jsonb not null default '[]';

create index if not exists agent_observations_agent_created_idx
  on agent_observations(agent_id, created_at desc);

create index if not exists agent_observations_world_created_idx
  on agent_observations(world_id, created_at desc);

create index if not exists agent_observations_subject_idx
  on agent_observations(world_id, subject);

create index if not exists agent_perception_summaries_agent_created_idx
  on agent_perception_summaries(agent_id, created_at desc);
