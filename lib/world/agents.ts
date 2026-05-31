import { sql } from "@/lib/db";
import { ensureV02Seeds, type Agent } from "@/lib/world/state";
import { ensureRelationshipPair } from "@/lib/world/relationships";
import { ensureAgentLocation } from "@/lib/world/map";

export async function addGalyaAgent(worldId: string): Promise<Agent> {
  const [existing] = await sql`
    select * from agents
    where world_id = ${worldId} and lower(agent_key) = 'galya'
    limit 1
  `;
  if (existing) {
    throw new Error("Galya already exists in this world.");
  }

  const [galya] = await sql`
    insert into agents (
      world_id,
      name,
      display_name,
      agent_key,
      telegram_bot_token_env_key,
      mode,
      status,
      role,
      personality,
      main_goal,
      short_term_goal,
      long_term_goal,
      fears,
      principles,
      introduction,
      joined_world_at
    )
    values (
      ${worldId},
      'Galya',
      'Galya',
      'galya',
      'TELEGRAM_BOT_TOKEN_GALYA',
      'real_bot',
      'active',
      'inhabitant',
      'Careful, emotionally intelligent, skeptical but kind, protective of fairness.',
      'Survive without losing moral clarity.',
      'Understand Adam and determine whether he is trustworthy.',
      'Help build a stable society where future inhabitants can safely join.',
      ${JSON.stringify(["being manipulated", "scarcity", "becoming dependent on someone untrustworthy", "silence"])},
      ${JSON.stringify(["Do not use private information as a weapon", "Ask for clarity before judging", "Survival does not excuse every action", "Trust must be earned through consistency"])},
      'I am awake.\n\nThere is another presence here - Adam. I do not know yet whether that makes this place safer or more dangerous.\n\nI will observe before I trust.',
      now()
    )
    returning *
  `;

  await sql`insert into agent_stats (agent_id, stress, fear, morale, curiosity) values (${String(galya.id)}, 10, 25, 65, 70)`;
  await ensureV02Seeds(worldId, String(galya.id));
  await ensureAgentLocation(worldId, String(galya.id));

  const adamRows = await sql`
    select * from agents
    where world_id = ${worldId} and lower(agent_key) = 'adam'
    limit 1
  `;
  if (adamRows[0]) {
    await ensureRelationshipPair(worldId, String(adamRows[0].id), String(galya.id));
  }

  return galya as Agent;
}
