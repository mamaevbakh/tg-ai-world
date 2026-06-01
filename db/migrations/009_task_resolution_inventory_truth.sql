create table if not exists agent_task_intentions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete set null,
  title text not null,
  status text not null default 'active',
  current_step text,
  required_action_type text,
  required_target text,
  required_secondary_target text,
  blockers jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  constraint agent_task_intentions_status_check check (status in ('active', 'completed', 'blocked', 'abandoned'))
);

create index if not exists agent_task_intentions_world_status_idx
  on agent_task_intentions(world_id, status, updated_at desc);

create unique index if not exists agent_task_intentions_active_unique_idx
  on agent_task_intentions(world_id, agent_id, lower(title))
  where status = 'active';

create table if not exists social_confirmations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  requester_agent_id uuid references agents(id) on delete cascade,
  target_agent_id uuid references agents(id) on delete cascade,
  confirmation_type text not null,
  subject text not null,
  status text not null default 'active',
  created_at timestamptz default now(),
  expires_tick integer,
  constraint social_confirmations_status_check check (status in ('active', 'expired', 'consumed', 'revoked'))
);

create index if not exists social_confirmations_world_active_idx
  on social_confirmations(world_id, status, expires_tick);
