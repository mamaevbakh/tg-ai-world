import { sql } from "@/lib/db";
import { clamp } from "@/lib/utils/clamp";
import type { Agent, WorldState } from "@/lib/world/state";
import type { Relationship } from "@/lib/world/relationships";

export const observationTypes = [
  "world",
  "resource",
  "shelter",
  "weather",
  "sound",
  "danger",
  "agent",
  "relationship",
  "memory",
  "experiment",
  "system"
] as const;

export const observationVisibilities = ["private_to_agent", "shared_publicly", "system_only"] as const;

export type ObservationType = (typeof observationTypes)[number];
export type ObservationVisibility = (typeof observationVisibilities)[number];

export type AgentObservation = {
  id: string;
  world_id: string;
  agent_id: string;
  tick_id: string | null;
  observation_type: ObservationType | string;
  subject: string;
  content: string;
  confidence: number;
  importance: number;
  emotional_valence: number;
  visibility: ObservationVisibility | string;
  created_at: string;
  agent_name?: string;
  agent_key?: string | null;
};

export type NewObservation = {
  observation_type: ObservationType;
  subject: string;
  content: string;
  confidence: number;
  importance: number;
  emotional_valence: number;
  visibility: ObservationVisibility;
};

export type AgentPerceptionContext = {
  recentObservations: AgentObservation[];
  summaries: Array<{ summary: string; subjects: unknown[]; created_at: string }>;
  recentPublicConversations: Array<{ speaker_name: string | null; message: string; created_at: string }>;
  relationships: Relationship[];
};

function safeObservationType(value: string): ObservationType {
  return observationTypes.includes(value as ObservationType) ? value as ObservationType : "world";
}

function safeVisibility(value: string): ObservationVisibility {
  return observationVisibilities.includes(value as ObservationVisibility) ? value as ObservationVisibility : "private_to_agent";
}

export async function loadAgentPerceptionContext(
  agentId: string,
  worldId: string,
  relationships: Relationship[]
): Promise<AgentPerceptionContext> {
  const recentObservations = await sql`
    select * from agent_observations
    where agent_id = ${agentId}
      and world_id = ${worldId}
      and visibility <> 'system_only'
    order by importance desc, created_at desc
    limit 12
  `;
  const summaries = await sql`
    select summary, subjects, created_at from agent_perception_summaries
    where agent_id = ${agentId} and world_id = ${worldId}
    order by created_at desc
    limit 3
  `;
  const conversations = await sql`
    select a.name as speaker_name, ac.message, ac.created_at
    from agent_conversations ac
    left join agents a on a.id = ac.speaker_agent_id
    where ac.world_id = ${worldId}
      and ac.visibility = 'public'
    order by ac.created_at desc
    limit 8
  `;

  return {
    recentObservations: recentObservations as AgentObservation[],
    summaries: summaries as Array<{ summary: string; subjects: unknown[]; created_at: string }>,
    recentPublicConversations: conversations as Array<{ speaker_name: string | null; message: string; created_at: string }>,
    relationships
  };
}

export async function createAgentObservation(input: {
  worldId: string;
  agentId: string;
  tickId?: string | null;
  observation: NewObservation;
}): Promise<AgentObservation> {
  const observation = input.observation;
  const [created] = await sql`
    insert into agent_observations (
      world_id,
      agent_id,
      tick_id,
      observation_type,
      subject,
      content,
      confidence,
      importance,
      emotional_valence,
      visibility
    )
    values (
      ${input.worldId},
      ${input.agentId},
      ${input.tickId ?? null},
      ${safeObservationType(observation.observation_type)},
      ${observation.subject.trim().slice(0, 160)},
      ${observation.content.trim().slice(0, 1000)},
      ${clamp(Math.round(observation.confidence), 0, 100)},
      ${clamp(Math.round(observation.importance), 1, 10)},
      ${clamp(Math.round(observation.emotional_valence), -10, 10)},
      ${safeVisibility(observation.visibility)}
    )
    returning *
  `;
  return created as AgentObservation;
}

export async function createAgentObservationsFromTick(input: {
  worldId: string;
  agentId: string;
  tickId: string;
  observations: NewObservation[];
}): Promise<AgentObservation[]> {
  const created: AgentObservation[] = [];
  for (const observation of input.observations.slice(0, 3)) {
    if (!observation.subject.trim() || !observation.content.trim()) continue;
    created.push(await createAgentObservation({
      worldId: input.worldId,
      agentId: input.agentId,
      tickId: input.tickId,
      observation
    }));
  }
  return created;
}

export async function summarizeAgentObservations(agentId: string): Promise<string> {
  const rows = await sql`
    select observation_type, subject, content, confidence, importance
    from agent_observations
    where agent_id = ${agentId}
      and visibility <> 'system_only'
    order by importance desc, created_at desc
    limit 10
  `;
  if (rows.length === 0) return "No observations yet.";

  const bySubject = new Map<string, string[]>();
  for (const row of rows) {
    const subject = String(row.subject);
    const items = bySubject.get(subject) ?? [];
    items.push(String(row.content));
    bySubject.set(subject, items);
  }

  return [...bySubject.entries()]
    .map(([subject, items]) => `${subject}: ${items.slice(0, 2).join(" ")}`)
    .join("\n");
}

export function formatObservationList(observations: AgentObservation[]): string {
  if (observations.length === 0) return "None";
  return observations
    .map((observation) => `- ${observation.content}`)
    .join("\n");
}

export async function loadRecentObservationsByAgent(worldId: string, agentKey?: string): Promise<AgentObservation[]> {
  const rows = agentKey
    ? await sql`
      select ao.*, a.name as agent_name, a.agent_key
      from agent_observations ao
      join agents a on a.id = ao.agent_id
      where ao.world_id = ${worldId}
        and lower(a.agent_key) = lower(${agentKey})
        and ao.visibility <> 'system_only'
      order by ao.created_at desc
      limit 12
    `
    : await sql`
      select ao.*, a.name as agent_name, a.agent_key
      from agent_observations ao
      join agents a on a.id = ao.agent_id
      where ao.world_id = ${worldId}
        and ao.visibility <> 'system_only'
      order by a.name asc, ao.created_at desc
      limit 24
    `;
  return rows as AgentObservation[];
}

export function defaultObservationForAction(input: {
  agent: Agent;
  actionType: string;
  target: string | null;
  description: string;
  worldState: WorldState;
}): NewObservation {
  const target = input.target || input.worldState.location || "world";
  const actionType = input.actionType;
  const observationType: ObservationType = actionType === "observe_agent"
    ? "agent"
    : target.includes("resource") || target.includes("storage")
      ? "resource"
      : target.includes("panel") || target.includes("sound")
        ? "sound"
        : "shelter";

  return {
    observation_type: observationType,
    subject: target,
    content: input.description,
    confidence: 70,
    importance: actionType === "observe" ? 4 : 5,
    emotional_valence: 0,
    visibility: "private_to_agent"
  };
}
