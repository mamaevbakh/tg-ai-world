alter table agents
  add column if not exists agent_key text,
  add column if not exists display_name text,
  add column if not exists introduction text,
  add column if not exists is_primary boolean not null default false,
  add column if not exists joined_world_at timestamptz,
  add column if not exists last_active_tick integer;

update agents
set agent_key = coalesce(agent_key, 'adam'),
    display_name = coalesce(display_name, name),
    is_primary = case when coalesce(agent_key, 'adam') = 'adam' then true else is_primary end,
    joined_world_at = coalesce(joined_world_at, created_at)
where agent_key is null or name = 'Adam';

create unique index if not exists agents_world_agent_key_unique
  on agents(world_id, agent_key)
  where agent_key is not null;

create table if not exists agent_relationships (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  source_agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete cascade,
  trust integer not null default 50,
  affinity integer not null default 50,
  tension integer not null default 0,
  respect integer not null default 50,
  fear integer not null default 0,
  relationship_type text not null default 'neutral',
  rationale text,
  interaction_count integer not null default 0,
  last_interaction_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(source_agent_id, target_agent_id)
);

create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  speaker_agent_id uuid references agents(id) on delete set null,
  target_agent_id uuid references agents(id) on delete set null,
  visibility text not null default 'public',
  message text not null,
  emotional_tone text,
  created_at timestamptz default now()
);

create table if not exists agent_reactions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  trigger_agent_id uuid references agents(id) on delete set null,
  reacting_agent_id uuid references agents(id) on delete cascade,
  reaction_type text not null,
  public_message text,
  relationship_effects jsonb not null default '{}',
  created_at timestamptz default now()
);

create table if not exists agent_turn_queue (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  reason text not null default 'round_robin',
  priority integer not null default 0,
  status text not null default 'pending',
  scheduled_for_tick integer,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists agent_relationships_world_idx on agent_relationships(world_id);
create index if not exists agent_conversations_world_created_idx on agent_conversations(world_id, created_at desc);
create index if not exists agent_reactions_tick_idx on agent_reactions(tick_id);
create index if not exists agent_turn_queue_world_status_idx on agent_turn_queue(world_id, status, priority desc);
