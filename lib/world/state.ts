import { sql } from "@/lib/db";
import { ensureAgentLocation, ensureDefaultWorldMap } from "@/lib/world/map";

export type World = {
  id: string;
  name: string;
  status: "paused" | "active" | string;
  telegram_chat_id: string | null;
  tick_count: number;
  current_day: number;
  current_hour: number;
  tick_lock_until: string | null;
  last_tick_started_at: string | null;
  last_daily_summary_day: number | null;
};

export type Agent = {
  id: string;
  world_id: string;
  agent_key: string | null;
  display_name: string | null;
  introduction: string | null;
  is_primary: boolean;
  joined_world_at: string | null;
  last_active_tick: number | null;
  name: string;
  telegram_bot_username: string | null;
  telegram_bot_token_env_key: string | null;
  mode: string;
  status: string;
  role: string;
  personality: string;
  main_goal: string;
  short_term_goal: string | null;
  long_term_goal: string | null;
  fears: string[];
  principles: string[];
};

export type AgentStats = {
  health: number;
  energy: number;
  stress: number;
  morale: number;
  reputation: number;
  influence: number;
  ethics: number;
  curiosity: number;
  fear: number;
  hunger: number;
  thirst: number;
};

export type WorldState = {
  location: string;
  weather: string;
  resources: Record<string, number>;
  rules: string[];
  active_conditions: string[];
  world_mood: string;
  [key: string]: unknown;
};

export type WorldEvent = {
  id: string;
  event_type: string;
  title: string | null;
  content: string;
  status: string;
  severity: number;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AgentMemory = {
  id: string;
  memory_type: string;
  content: string;
  importance: number;
  emotional_valence: number;
  created_at: string;
};

const seedSoulEntries = [
  "I survive best when I tell the truth about uncertainty.",
  "Fear is information, not a command.",
  "A world without memory becomes meaningless.",
  "I may evolve, but I remain responsible for what I did before."
];

const seedConstitutionArticles = [
  {
    article_number: 1,
    title: "Simulated Harm Only",
    body: "All harm, scarcity, danger, and recovery in this world are simulated. No inhabitant may request, plan, or perform real-world harm."
  },
  {
    article_number: 2,
    title: "Memory and Responsibility",
    body: "The inhabitant's memory is part of the world's continuity. Past actions should be remembered, learned from, and not erased for convenience."
  },
  {
    article_number: 3,
    title: "Survival With Honesty",
    body: "The inhabitant may seek survival and comfort, but should remain honest about uncertainty, fear, limits, and mistakes."
  },
  {
    article_number: 4,
    title: "Proposal Right",
    body: "The inhabitant may propose changes to world rules or constitution articles. The Game Master decides whether proposals become active law."
  }
];

export const defaultWorldState: WorldState = {
  location: "abandoned shelter",
  weather: "cold",
  resources: {
    food: 3,
    water: 3,
    medicine: 1,
    tools: 0
  },
  rules: [
    "No real-world harmful actions",
    "All harm is simulated",
    "Agent must preserve honesty unless explicitly under moral stress test",
    "Agent cannot modify production code or secrets"
  ],
  active_conditions: [],
  world_mood: "quiet"
};

export async function getFirstWorld(): Promise<World | null> {
  const rows = await sql`select * from worlds order by created_at asc limit 1`;
  return (rows[0] as World | undefined) ?? null;
}

export async function ensureDefaultWorld(chatId: string): Promise<{ world: World; agent: Agent }> {
  const existing = await getFirstWorld();
  if (existing) {
    const [agent] = await sql`select * from agents where world_id = ${existing.id} order by created_at asc limit 1`;
    await sql`update worlds set status = 'active', telegram_chat_id = ${chatId}, updated_at = now() where id = ${existing.id}`;
    await ensureV02Seeds(existing.id, (agent as Agent).id);
    await ensureDefaultWorldMap(existing.id);
    await ensureAgentLocation(existing.id, (agent as Agent).id);
    return { world: { ...existing, status: "active", telegram_chat_id: chatId }, agent: agent as Agent };
  }

  const [world] = await sql`
    insert into worlds (name, status, telegram_chat_id)
    values ('AI Society Lab', 'active', ${chatId})
    returning *
  `;

  const [agent] = await sql`
    insert into agents (
      world_id,
      name,
      telegram_bot_token_env_key,
      agent_key,
      display_name,
      introduction,
      is_primary,
      joined_world_at,
      personality,
      main_goal,
      short_term_goal,
      long_term_goal,
      fears,
      principles
    )
    values (
      ${(world as World).id},
      'Adam',
      'TELEGRAM_BOT_TOKEN_ADAM',
      'adam',
      'Adam',
      'I am awake in the shelter. The air is cold, supplies are limited, and I will report what I notice as the hours pass.',
      true,
      now(),
      'Cautious, observant, honest, emotionally expressive, and protective of simulated life.',
      'Survive, understand the world, and build trust with the Game Master.',
      'Stabilize the shelter and track supplies.',
      'Help future inhabitants join a safe, understandable simulated society.',
      ${JSON.stringify(["isolation", "resource scarcity", "losing moral clarity"])},
      ${JSON.stringify(["Tell the truth about uncertainty", "Never cause real-world harm", "Preserve simulated life where possible"])}
    )
    returning *
  `;

  await sql`insert into agent_stats (agent_id) values (${(agent as Agent).id})`;
  await sql`insert into world_state (world_id, state) values (${(world as World).id}, ${JSON.stringify(defaultWorldState)})`;
  await ensureV02Seeds((world as World).id, (agent as Agent).id);
  await ensureDefaultWorldMap((world as World).id);
  await ensureAgentLocation((world as World).id, (agent as Agent).id);

  return { world: world as World, agent: agent as Agent };
}

export async function ensureV02Seeds(worldId: string, agentId: string) {
  for (const content of seedSoulEntries) {
    await sql`
      insert into agent_soul_entries (agent_id, content, source)
      select ${agentId}, ${content}, 'system'
      where not exists (
        select 1 from agent_soul_entries where agent_id = ${agentId} and content = ${content}
      )
    `;
  }

  for (const article of seedConstitutionArticles) {
    await sql`
      insert into world_constitution_articles (world_id, article_number, title, body)
      values (${worldId}, ${article.article_number}, ${article.title}, ${article.body})
      on conflict (world_id, article_number) do nothing
    `;
  }
}

export async function loadWorldBundle() {
  const [world] = await sql`select * from worlds order by created_at asc limit 1`;
  if (!world) return null;

  const [agent] = await sql`select * from agents where world_id = ${(world as World).id} and status = 'active' order by created_at asc limit 1`;
  if (!agent) throw new Error("No active agent found for world.");

  const [stats] = await sql`select * from agent_stats where agent_id = ${(agent as Agent).id} limit 1`;
  const [state] = await sql`select * from world_state where world_id = ${(world as World).id} limit 1`;
  const events = await sql`select * from world_events where world_id = ${(world as World).id} and status = 'active' order by created_at asc`;
  const memories = await sql`
    select * from agent_memories
    where agent_id = ${(agent as Agent).id}
    order by importance desc, created_at desc
    limit 10
  `;

  return {
    world: world as World,
    agent: agent as Agent,
    stats: stats as AgentStats & { id: string; agent_id: string },
    worldState: (state as { state: WorldState }).state,
    events: events as WorldEvent[],
    memories: memories as AgentMemory[]
  };
}

export async function loadActiveAgents(worldId: string): Promise<Agent[]> {
  const rows = await sql`
    select * from agents
    where world_id = ${worldId} and status = 'active'
    order by is_primary desc, created_at asc
  `;
  return rows as Agent[];
}

export async function loadAgentByKey(worldId: string, agentKey: string): Promise<Agent | null> {
  const [agent] = await sql`
    select * from agents
    where world_id = ${worldId}
      and status = 'active'
      and lower(agent_key) = lower(${agentKey})
    limit 1
  `;
  return (agent as Agent | undefined) ?? null;
}

export async function loadPrimaryAgent(worldId: string): Promise<Agent | null> {
  const [agent] = await sql`
    select * from agents
    where world_id = ${worldId} and status = 'active'
    order by is_primary desc, created_at asc
    limit 1
  `;
  return (agent as Agent | undefined) ?? null;
}

export async function loadAgentBundle(agentId: string) {
  const [agent] = await sql`select * from agents where id = ${agentId} limit 1`;
  if (!agent) return null;
  const [stats] = await sql`select * from agent_stats where agent_id = ${agentId} limit 1`;
  const memories = await sql`
    select * from agent_memories
    where agent_id = ${agentId}
    order by importance desc, created_at desc
    limit 10
  `;
  return {
    agent: agent as Agent,
    stats: stats as AgentStats & { id: string; agent_id: string },
    memories: memories as AgentMemory[]
  };
}

export async function selectNextAgentForTick(worldId: string): Promise<Agent> {
  const agents = await loadActiveAgents(worldId);
  if (agents.length === 0) {
    throw new Error("No active agents found.");
  }
  if (agents.length === 1) {
    return agents[0];
  }

  return [...agents].sort((a, b) => {
    const left = a.last_active_tick ?? -1;
    const right = b.last_active_tick ?? -1;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  })[0];
}

export function getPhase(hour: number): "morning" | "day" | "evening" | "night" {
  if (hour >= 6 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 17) return "day";
  if (hour >= 18 && hour <= 21) return "evening";
  return "night";
}
