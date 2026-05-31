import { sql } from "@/lib/db";
import { clamp } from "@/lib/utils/clamp";
import type { Agent, AgentStats, WorldEvent } from "@/lib/world/state";
import type { Relationship, RelationshipEffects } from "@/lib/world/relationships";

export const socialInteractionTypes = [
  "conversation",
  "request_help",
  "offer_help",
  "warning",
  "disagreement",
  "comfort",
  "trust_check",
  "negotiation",
  "planning",
  "confession",
  "challenge",
  "apology",
  "joint_task_discussion"
] as const;

export const socialTurnIntents = [
  "ask",
  "answer",
  "agree",
  "disagree",
  "warn",
  "comfort",
  "request",
  "offer",
  "promise",
  "refuse",
  "clarify",
  "challenge",
  "apologize",
  "plan",
  "end"
] as const;

export type SocialInteractionType = (typeof socialInteractionTypes)[number];
export type SocialTurnIntent = (typeof socialTurnIntents)[number];

export type SocialInteraction = {
  id: string;
  world_id: string;
  initiating_agent_id: string;
  target_agent_id: string;
  tick_id: string | null;
  interaction_type: SocialInteractionType | string;
  topic: string;
  status: string;
  importance: number;
  created_at: string;
  resolved_at: string | null;
  initiating_agent_name?: string;
  target_agent_name?: string;
};

export type SocialTurn = {
  id: string;
  interaction_id: string;
  world_id: string;
  speaker_agent_id: string;
  target_agent_id: string | null;
  message: string;
  emotional_tone: string | null;
  intent: SocialTurnIntent | string | null;
  created_at: string;
  speaker_name?: string;
  target_name?: string;
};

export type AgentCommitment = {
  id: string;
  world_id: string;
  agent_id: string;
  target_agent_id: string | null;
  interaction_id: string | null;
  commitment_type: string;
  content: string;
  status: string;
  due_tick: number | null;
  fulfilled_tick: number | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  target_agent_name?: string;
};

export type JointTask = {
  id: string;
  world_id: string;
  title: string;
  description: string;
  status: string;
  created_by_agent_id: string | null;
  assigned_agent_ids: string[];
  required_location_key: string | null;
  required_object_key: string | null;
  steps: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type RelationshipEvent = {
  id: string;
  world_id: string;
  source_agent_id: string;
  target_agent_id: string;
  tick_id: string | null;
  event_type: string;
  summary: string;
  effects: RelationshipEffects;
  created_at: string;
};

function normalizeType<T extends readonly string[]>(value: string, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(value) ? value as T[number] : fallback;
}

export function clampSocialRelationshipEffects(effects: RelationshipEffects): RelationshipEffects {
  return {
    trust: clamp(effects.trust ?? 0, -5, 5),
    affinity: clamp(effects.affinity ?? 0, -5, 5),
    tension: clamp(effects.tension ?? 0, -8, 8),
    respect: clamp(effects.respect ?? 0, -5, 5),
    fear: clamp(effects.fear ?? 0, -5, 5)
  };
}

export async function getActiveSocialInteractions(worldId: string): Promise<SocialInteraction[]> {
  const rows = await sql`
    select asi.*, init.name as initiating_agent_name, target.name as target_agent_name
    from agent_social_interactions asi
    join agents init on init.id = asi.initiating_agent_id
    join agents target on target.id = asi.target_agent_id
    where asi.world_id = ${worldId} and asi.status = 'active'
    order by asi.created_at desc
  `;
  return rows as SocialInteraction[];
}

export async function createSocialInteraction(input: {
  worldId: string;
  initiatingAgentId: string;
  targetAgentId: string;
  tickId?: string | null;
  interactionType: string;
  topic: string;
  importance?: number;
  force?: boolean;
}): Promise<SocialInteraction | null> {
  if (!input.force) {
    const active = await sql`
      select id from agent_social_interactions
      where world_id = ${input.worldId}
        and status = 'active'
        and (
          (initiating_agent_id = ${input.initiatingAgentId} and target_agent_id = ${input.targetAgentId})
          or
          (initiating_agent_id = ${input.targetAgentId} and target_agent_id = ${input.initiatingAgentId})
        )
      limit 1
    `;
    if (active.length > 0) return null;
  }

  const [created] = await sql`
    insert into agent_social_interactions (
      world_id,
      initiating_agent_id,
      target_agent_id,
      tick_id,
      interaction_type,
      topic,
      importance
    )
    values (
      ${input.worldId},
      ${input.initiatingAgentId},
      ${input.targetAgentId},
      ${input.tickId ?? null},
      ${normalizeType(input.interactionType, socialInteractionTypes, "conversation")},
      ${input.topic.slice(0, 240)},
      ${clamp(input.importance ?? 5, 1, 10)}
    )
    returning *
  `;
  return created as SocialInteraction;
}

export async function addSocialTurn(input: {
  interactionId: string;
  worldId: string;
  speakerAgentId: string;
  targetAgentId?: string | null;
  message: string;
  emotionalTone?: string | null;
  intent?: string | null;
}): Promise<SocialTurn> {
  const [created] = await sql`
    insert into agent_social_turns (
      interaction_id,
      world_id,
      speaker_agent_id,
      target_agent_id,
      message,
      emotional_tone,
      intent
    )
    values (
      ${input.interactionId},
      ${input.worldId},
      ${input.speakerAgentId},
      ${input.targetAgentId ?? null},
      ${input.message.slice(0, 1200)},
      ${input.emotionalTone ?? null},
      ${input.intent ? normalizeType(input.intent, socialTurnIntents, "clarify") : null}
    )
    returning *
  `;
  return created as SocialTurn;
}

export async function resolveSocialInteraction(interactionId: string): Promise<void> {
  await sql`
    update agent_social_interactions
    set status = 'resolved',
        resolved_at = now()
    where id = ${interactionId}
  `;
}

export async function getRecentSocialTurns(worldId: string, limit = 8): Promise<SocialTurn[]> {
  const rows = await sql`
    select ast.*, speaker.name as speaker_name, target.name as target_name
    from agent_social_turns ast
    join agents speaker on speaker.id = ast.speaker_agent_id
    left join agents target on target.id = ast.target_agent_id
    where ast.world_id = ${worldId}
    order by ast.created_at desc
    limit ${limit}
  `;
  return rows as SocialTurn[];
}

export async function getOpenCommitments(worldId: string, agentId?: string): Promise<AgentCommitment[]> {
  const rows = agentId
    ? await sql`
      select ac.*, a.name as agent_name, target.name as target_agent_name
      from agent_commitments ac
      join agents a on a.id = ac.agent_id
      left join agents target on target.id = ac.target_agent_id
      where ac.world_id = ${worldId}
        and ac.status = 'open'
        and ac.agent_id = ${agentId}
      order by ac.created_at desc
    `
    : await sql`
      select ac.*, a.name as agent_name, target.name as target_agent_name
      from agent_commitments ac
      join agents a on a.id = ac.agent_id
      left join agents target on target.id = ac.target_agent_id
      where ac.world_id = ${worldId}
        and ac.status = 'open'
      order by ac.created_at desc
    `;
  return rows as AgentCommitment[];
}

export async function createCommitment(input: {
  worldId: string;
  agentId: string;
  targetAgentId?: string | null;
  interactionId?: string | null;
  commitmentType: string;
  content: string;
  dueTick?: number | null;
  force?: boolean;
}): Promise<AgentCommitment | null> {
  if (!input.force) {
    const existing = await getOpenCommitments(input.worldId, input.agentId);
    if (existing.length >= 3) return null;
  }
  const [created] = await sql`
    insert into agent_commitments (
      world_id,
      agent_id,
      target_agent_id,
      interaction_id,
      commitment_type,
      content,
      due_tick
    )
    values (
      ${input.worldId},
      ${input.agentId},
      ${input.targetAgentId ?? null},
      ${input.interactionId ?? null},
      ${input.commitmentType},
      ${input.content.slice(0, 600)},
      ${input.dueTick ?? null}
    )
    returning *
  `;
  return created as AgentCommitment;
}

export async function updateCommitmentStatus(input: {
  commitmentId: string;
  status: "fulfilled" | "broken" | "canceled";
  fulfilledTick?: number | null;
}): Promise<void> {
  await sql`
    update agent_commitments
    set status = ${input.status},
        fulfilled_tick = ${input.fulfilledTick ?? null},
        updated_at = now()
    where id = ${input.commitmentId}
  `;
}

export async function createJointTask(input: {
  worldId: string;
  title: string;
  description: string;
  createdByAgentId?: string | null;
  assignedAgentIds: string[];
  requiredLocationKey?: string | null;
  requiredObjectKey?: string | null;
  steps?: Array<Record<string, unknown>>;
  force?: boolean;
}): Promise<JointTask | null> {
  if (!input.force) {
    const active = await getActiveJointTasks(input.worldId);
    if (active.length >= 2) return null;
  }
  const [created] = await sql`
    insert into joint_tasks (
      world_id,
      title,
      description,
      created_by_agent_id,
      assigned_agent_ids,
      required_location_key,
      required_object_key,
      steps
    )
    values (
      ${input.worldId},
      ${input.title.slice(0, 160)},
      ${input.description.slice(0, 1000)},
      ${input.createdByAgentId ?? null},
      ${JSON.stringify(input.assignedAgentIds)},
      ${input.requiredLocationKey ?? null},
      ${input.requiredObjectKey ?? null},
      ${JSON.stringify(input.steps ?? [])}
    )
    returning *
  `;
  return created as JointTask;
}

export async function getActiveJointTasks(worldId: string): Promise<JointTask[]> {
  const rows = await sql`
    select * from joint_tasks
    where world_id = ${worldId} and status = 'active'
    order by created_at desc
  `;
  return rows as JointTask[];
}

export async function updateJointTask(input: {
  taskId: string;
  status?: "active" | "completed" | "failed" | "abandoned";
  steps?: Array<Record<string, unknown>>;
}): Promise<void> {
  await sql`
    update joint_tasks
    set status = coalesce(${input.status ?? null}, status),
        steps = coalesce(${input.steps ? JSON.stringify(input.steps) : null}::jsonb, steps),
        completed_at = case when ${input.status ?? null} = 'completed' then now() else completed_at end,
        updated_at = now()
    where id = ${input.taskId}
  `;
}

export async function createRelationshipEvent(input: {
  worldId: string;
  sourceAgentId: string;
  targetAgentId: string;
  tickId?: string | null;
  eventType: string;
  summary: string;
  effects: RelationshipEffects;
}): Promise<RelationshipEvent> {
  const effects = clampSocialRelationshipEffects(input.effects);
  const [created] = await sql`
    insert into relationship_events (
      world_id,
      source_agent_id,
      target_agent_id,
      tick_id,
      event_type,
      summary,
      effects
    )
    values (
      ${input.worldId},
      ${input.sourceAgentId},
      ${input.targetAgentId},
      ${input.tickId ?? null},
      ${input.eventType},
      ${input.summary.slice(0, 500)},
      ${JSON.stringify(effects)}
    )
    returning *
  `;
  return created as RelationshipEvent;
}

export async function getRecentRelationshipEvents(worldId: string, limit = 8): Promise<RelationshipEvent[]> {
  const rows = await sql`
    select * from relationship_events
    where world_id = ${worldId}
    order by created_at desc
    limit ${limit}
  `;
  return rows as RelationshipEvent[];
}

export async function updateCommitmentsForAction(input: {
  worldId: string;
  agentId: string;
  tickNumber: number;
  actionType: string;
  target?: string | null;
}): Promise<AgentCommitment[]> {
  const commitments = await getOpenCommitments(input.worldId, input.agentId);
  const actionNeedles = [
    input.actionType.replace(/_/g, " "),
    input.actionType,
    input.target ?? ""
  ].map((value) => value.toLowerCase()).filter(Boolean);
  const fulfilled: AgentCommitment[] = [];

  for (const commitment of commitments) {
    const content = commitment.content.toLowerCase();
    if (!actionNeedles.some((needle) => content.includes(needle))) continue;
    await updateCommitmentStatus({
      commitmentId: commitment.id,
      status: "fulfilled",
      fulfilledTick: input.tickNumber
    });
    fulfilled.push(commitment);
  }

  return fulfilled;
}

export async function shouldTriggerSocialInteraction(input: {
  worldId: string;
  actingAgent: Agent;
  targetAgent: Agent;
  actingStats: AgentStats;
  targetStats: AgentStats;
  relationship: Relationship | null;
  sameLocation: boolean;
  actionType: string;
  resourceChanged: boolean;
  meaningfulStateChange: boolean;
  activeEvents: WorldEvent[];
  activeExperiment: boolean;
  openCommitments: AgentCommitment[];
  force?: boolean;
}): Promise<boolean> {
  if (input.force) return true;

  const activePair = await sql`
    select id from agent_social_interactions
    where world_id = ${input.worldId}
      and status = 'active'
      and (
        (initiating_agent_id = ${input.actingAgent.id} and target_agent_id = ${input.targetAgent.id})
        or
        (initiating_agent_id = ${input.targetAgent.id} and target_agent_id = ${input.actingAgent.id})
      )
    limit 1
  `;
  if (activePair.length > 0) return false;

  const recent = await sql`
    select id from agent_social_turns
    where world_id = ${input.worldId}
      and created_at > now() - interval '70 minutes'
    limit 1
  `;

  let chance = 25;
  if (input.sameLocation) chance += 25;
  if (input.resourceChanged) chance += 20;
  if (input.activeExperiment) chance += 15;
  if ((input.relationship?.tension ?? 0) > 40) chance += 15;
  if ((input.relationship?.trust ?? 50) < 35) chance += 10;
  if (input.actingStats.stress > 60 || input.targetStats.stress > 60) chance += 10;
  if (input.actingStats.fear > 60 || input.targetStats.fear > 60) chance += 10;
  if (["share_observation", "ask_agent", "repair_object", "use_item_on_object", "eat_food", "drink_water", "search_resources"].includes(input.actionType)) chance += 15;
  if (input.openCommitments.length > 0) chance += 20;
  if (recent.length > 0) chance -= 30;
  if (input.actingStats.energy < 15) chance -= 15;
  if (input.targetStats.energy < 15) chance -= 15;
  if (!input.meaningfulStateChange) chance -= 20;
  chance = clamp(chance, 0, 80);

  return Math.random() * 100 < chance;
}
