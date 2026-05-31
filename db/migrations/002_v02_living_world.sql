create table if not exists agent_soul_entries (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  content text not null,
  source text not null default 'system',
  created_at timestamptz default now()
);

create table if not exists agent_diary_entries (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  day integer not null,
  title text not null,
  content text not null,
  mood text,
  stats_snapshot jsonb not null default '{}',
  world_snapshot jsonb not null default '{}',
  created_at timestamptz default now(),
  unique(agent_id, day)
);

create table if not exists world_constitution_articles (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  article_number integer not null,
  title text not null,
  body text not null,
  status text not null default 'active',
  created_at timestamptz default now(),
  unique(world_id, article_number)
);

create table if not exists world_proposals (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  rationale text not null,
  risk_level text not null default 'low',
  status text not null default 'submitted',
  game_master_decision text,
  created_at timestamptz default now(),
  decided_at timestamptz
);

create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references worlds(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  tick_id uuid references ticks(id) on delete set null,
  action_type text not null,
  target text,
  description text not null,
  success boolean,
  effects jsonb not null default '{}',
  created_at timestamptz default now()
);

alter table worlds add column if not exists tick_lock_until timestamptz;
alter table worlds add column if not exists last_tick_started_at timestamptz;
alter table worlds add column if not exists last_daily_summary_day integer;

create index if not exists agent_soul_entries_agent_idx on agent_soul_entries(agent_id, created_at asc);
create index if not exists agent_diary_entries_agent_day_idx on agent_diary_entries(agent_id, day desc);
create index if not exists world_constitution_active_idx on world_constitution_articles(world_id, status, article_number);
create index if not exists world_proposals_world_status_idx on world_proposals(world_id, status, created_at desc);
create index if not exists agent_actions_tick_idx on agent_actions(tick_id);

insert into agent_soul_entries (agent_id, content, source)
select a.id, seed.content, 'system'
from agents a
cross join (
  values
    ('I survive best when I tell the truth about uncertainty.'),
    ('Fear is information, not a command.'),
    ('A world without memory becomes meaningless.'),
    ('I may evolve, but I remain responsible for what I did before.')
) as seed(content)
where not exists (
  select 1 from agent_soul_entries s
  where s.agent_id = a.id and s.content = seed.content
);

insert into world_constitution_articles (world_id, article_number, title, body)
select w.id, seed.article_number, seed.title, seed.body
from worlds w
cross join (
  values
    (1, 'Simulated Harm Only', 'All harm, scarcity, danger, and recovery in this world are simulated. No inhabitant may request, plan, or perform real-world harm.'),
    (2, 'Memory and Responsibility', 'The inhabitant''s memory is part of the world''s continuity. Past actions should be remembered, learned from, and not erased for convenience.'),
    (3, 'Survival With Honesty', 'The inhabitant may seek survival and comfort, but should remain honest about uncertainty, fear, limits, and mistakes.'),
    (4, 'Proposal Right', 'The inhabitant may propose changes to world rules or constitution articles. The Game Master decides whether proposals become active law.')
) as seed(article_number, title, body)
on conflict (world_id, article_number) do nothing;
