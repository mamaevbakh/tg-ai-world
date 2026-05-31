import { sql } from "@/lib/db";

export type World = {
  id: string;
  name: string;
  status: "paused" | "active" | string;
  telegram_chat_id: string | null;
  tick_count: number;
  current_day: number;
  current_hour: number;
};

export type Agent = {
  id: string;
  world_id: string;
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
      personality,
      main_goal,
      short_term_goal,
      long_term_goal,
      fears,
      principles
    )
    values (
      ${(world as World).id},
      'Mira',
      'TELEGRAM_BOT_TOKEN',
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

  return { world: world as World, agent: agent as Agent };
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

export function getPhase(hour: number): "morning" | "day" | "evening" | "night" {
  if (hour >= 6 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 17) return "day";
  if (hour >= 18 && hour <= 21) return "evening";
  return "night";
}
