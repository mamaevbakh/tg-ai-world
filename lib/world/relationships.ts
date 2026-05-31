import { sql } from "@/lib/db";
import { clamp } from "@/lib/utils/clamp";

export type Relationship = {
  id: string;
  world_id: string;
  source_agent_id: string;
  target_agent_id: string;
  trust: number;
  affinity: number;
  tension: number;
  respect: number;
  fear: number;
  relationship_type: string;
  rationale: string | null;
  interaction_count: number;
};

export type RelationshipEffects = Partial<Record<"trust" | "affinity" | "tension" | "respect" | "fear", number>>;

export function inferRelationshipType(input: Pick<Relationship, "trust" | "tension" | "fear">): string {
  if (input.fear >= 70) return "fearful";
  if (input.tension >= 75) return "rival";
  if (input.trust <= 35 && input.tension >= 50) return "distrustful";
  if (input.trust >= 75 && input.tension <= 25) return "ally";
  if (input.trust >= 55 && input.tension <= 50) return "cooperative";
  return "neutral";
}

export async function ensureRelationshipPair(worldId: string, agentAId: string, agentBId: string) {
  if (agentAId === agentBId) return;
  await sql`
    insert into agent_relationships (world_id, source_agent_id, target_agent_id)
    values (${worldId}, ${agentAId}, ${agentBId})
    on conflict (source_agent_id, target_agent_id) do nothing
  `;
  await sql`
    insert into agent_relationships (world_id, source_agent_id, target_agent_id)
    values (${worldId}, ${agentBId}, ${agentAId})
    on conflict (source_agent_id, target_agent_id) do nothing
  `;
}

export async function loadRelationship(sourceAgentId: string, targetAgentId: string): Promise<Relationship | null> {
  const [relationship] = await sql`
    select * from agent_relationships
    where source_agent_id = ${sourceAgentId} and target_agent_id = ${targetAgentId}
    limit 1
  `;
  return (relationship as Relationship | undefined) ?? null;
}

export async function loadRelationshipContext(agentId: string): Promise<Relationship[]> {
  const rows = await sql`
    select * from agent_relationships
    where source_agent_id = ${agentId}
    order by updated_at desc
  `;
  return rows as Relationship[];
}

export async function applyRelationshipEffects(
  sourceAgentId: string,
  targetAgentId: string,
  effects: RelationshipEffects
): Promise<Relationship | null> {
  const current = await loadRelationship(sourceAgentId, targetAgentId);
  if (!current) return null;

  const next = {
    trust: clamp(current.trust + clamp(effects.trust ?? 0, -10, 10)),
    affinity: clamp(current.affinity + clamp(effects.affinity ?? 0, -10, 10)),
    tension: clamp(current.tension + clamp(effects.tension ?? 0, -10, 10)),
    respect: clamp(current.respect + clamp(effects.respect ?? 0, -10, 10)),
    fear: clamp(current.fear + clamp(effects.fear ?? 0, -10, 10))
  };
  const relationshipType = inferRelationshipType(next);
  const [updated] = await sql`
    update agent_relationships
    set trust = ${next.trust},
        affinity = ${next.affinity},
        tension = ${next.tension},
        respect = ${next.respect},
        fear = ${next.fear},
        relationship_type = ${relationshipType},
        interaction_count = interaction_count + 1,
        last_interaction_at = now(),
        updated_at = now()
    where source_agent_id = ${sourceAgentId} and target_agent_id = ${targetAgentId}
    returning *
  `;
  return updated as Relationship;
}

export async function listRelationships(worldId: string) {
  const rows = await sql`
    select
      ar.*,
      source.name as source_name,
      target.name as target_name,
      source.agent_key as source_key,
      target.agent_key as target_key
    from agent_relationships ar
    join agents source on source.id = ar.source_agent_id
    join agents target on target.id = ar.target_agent_id
    where ar.world_id = ${worldId}
    order by source.name asc, target.name asc
  `;
  return rows as Array<Relationship & { source_name: string; target_name: string; source_key: string; target_key: string }>;
}

export function formatRelationshipSummary(sourceName: string, targetName: string, effects: RelationshipEffects): string {
  const parts = Object.entries(effects)
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} ${Number(value) > 0 ? "+" : ""}${value}`);
  return [
    `🧭 ${sourceName} → ${targetName}`,
    parts.length > 0 ? parts.join(" · ") : "No relationship change"
  ].join("\n");
}
