create table if not exists agent_social_interactions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  initiating_agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  interaction_type text not null,
  topic text not null,
  status text not null default 'active',
  importance integer not null default 5,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists agent_social_turns (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid references agent_social_interactions(id) on delete cascade,
  world_id uuid references worlds(id) on delete cascade,
  speaker_agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete set null,
  message text not null,
  emotional_tone text,
  intent text,
  created_at timestamptz default now()
);

create table if not exists agent_commitments (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete set null,
  interaction_id uuid references agent_social_interactions(id) on delete set null,
  commitment_type text not null,
  content text not null,
  status text not null default 'open',
  due_tick integer,
  fulfilled_tick integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists joint_tasks (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  title text not null,
  description text not null,
  status text not null default 'active',
  created_by_agent_id uuid references agents(id) on delete set null,
  assigned_agent_ids jsonb not null default '[]',
  required_location_key text,
  required_object_key text,
  steps jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists relationship_events (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  source_agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  event_type text not null,
  summary text not null,
  effects jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists agent_social_interactions_world_status_idx
  on agent_social_interactions(world_id, status, created_at desc);

create index if not exists agent_social_turns_interaction_created_idx
  on agent_social_turns(interaction_id, created_at asc);

create index if not exists agent_commitments_world_status_idx
  on agent_commitments(world_id, status, created_at desc);

create index if not exists joint_tasks_world_status_idx
  on joint_tasks(world_id, status, created_at desc);

create index if not exists relationship_events_world_created_idx
  on relationship_events(world_id, created_at desc);
