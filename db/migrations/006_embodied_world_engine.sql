create table if not exists world_locations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  location_key text not null,
  name text not null,
  description text not null,
  area_type text not null default 'indoor',
  danger_level integer not null default 0,
  is_discovered boolean not null default true,
  metadata jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(world_id, location_key)
);

create table if not exists world_location_exits (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  from_location_id uuid references world_locations(id) on delete cascade,
  to_location_id uuid references world_locations(id) on delete cascade,
  direction text not null,
  is_blocked boolean not null default false,
  blocked_reason text,
  required_object_key text,
  created_at timestamptz default now(),
  unique(from_location_id, direction)
);

create table if not exists world_objects (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  location_id uuid references world_locations(id) on delete set null,
  object_key text not null,
  name text not null,
  description text not null,
  object_type text not null,
  state jsonb not null default '{}',
  is_visible boolean not null default true,
  is_portable boolean not null default false,
  is_container boolean not null default false,
  is_usable boolean not null default false,
  durability integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(world_id, object_key)
);

create table if not exists world_object_contents (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  container_object_id uuid references world_objects(id) on delete cascade,
  contained_object_id uuid references world_objects(id) on delete cascade,
  is_hidden boolean not null default false,
  discovered_at timestamptz,
  created_at timestamptz default now(),
  unique(container_object_id, contained_object_id)
);

create table if not exists agent_locations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  location_id uuid references world_locations(id) on delete cascade,
  updated_at timestamptz default now(),
  unique(agent_id)
);

create table if not exists agent_inventory_items (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  object_id uuid references world_objects(id) on delete cascade,
  quantity integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(agent_id, object_id)
);

create table if not exists object_interactions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  location_id uuid references world_locations(id) on delete set null,
  object_id uuid references world_objects(id) on delete set null,
  action_type text not null,
  success boolean not null default true,
  feedback text not null,
  effects jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists world_locations_world_idx on world_locations(world_id);
create index if not exists world_objects_world_location_idx on world_objects(world_id, location_id);
create index if not exists world_objects_world_key_idx on world_objects(world_id, object_key);
create index if not exists agent_locations_world_idx on agent_locations(world_id);
create index if not exists agent_inventory_items_agent_idx on agent_inventory_items(agent_id);
create index if not exists object_interactions_agent_created_idx on object_interactions(agent_id, created_at desc);
