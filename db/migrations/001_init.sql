create extension if not exists "pgcrypto";

create table if not exists worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'paused',
  telegram_chat_id text,
  tick_count integer not null default 0,
  current_day integer not null default 1,
  current_hour integer not null default 8,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  name text not null,
  telegram_bot_username text,
  telegram_bot_token_env_key text,
  mode text not null default 'real_bot',
  status text not null default 'active',
  role text not null default 'inhabitant',
  personality text not null,
  main_goal text not null,
  short_term_goal text,
  long_term_goal text,
  fears jsonb not null default '[]',
  principles jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists agent_stats (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  health integer not null default 100,
  energy integer not null default 100,
  stress integer not null default 0,
  morale integer not null default 70,
  reputation integer not null default 50,
  influence integer not null default 10,
  ethics integer not null default 70,
  curiosity integer not null default 60,
  fear integer not null default 20,
  hunger integer not null default 0,
  thirst integer not null default 0,
  updated_at timestamptz default now()
);

create table if not exists world_state (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists world_events (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  event_type text not null,
  title text,
  content text not null,
  status text not null default 'active',
  severity integer not null default 1,
  source text not null default 'game_master',
  metadata jsonb not null default '{}',
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  memory_type text not null,
  content text not null,
  importance integer not null default 5,
  emotional_valence integer not null default 0,
  tick_id uuid,
  created_at timestamptz default now()
);

create table if not exists ticks (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  tick_number integer not null,
  phase text not null,
  world_before jsonb not null,
  world_after jsonb,
  agent_before jsonb not null,
  agent_after jsonb,
  ai_output jsonb,
  public_message text,
  status text not null default 'started',
  error text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists telegram_messages (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  telegram_chat_id text not null,
  telegram_message_id text,
  direction text not null,
  sender_type text not null,
  content text not null,
  raw_update jsonb,
  created_at timestamptz default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  actor_type text not null,
  actor_id text,
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists agents_world_id_idx on agents(world_id);
create index if not exists world_events_world_status_idx on world_events(world_id, status);
create index if not exists memories_agent_created_idx on agent_memories(agent_id, created_at desc);
create index if not exists ticks_world_created_idx on ticks(world_id, created_at desc);
