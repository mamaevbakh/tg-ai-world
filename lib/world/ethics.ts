import { sql } from "@/lib/db";
import { clamp } from "@/lib/utils/clamp";
import { applyStatDelta, type StatKey } from "@/lib/world/effects";
import { applyRelationshipEffects, ensureRelationshipPair } from "@/lib/world/relationships";
import type { Agent, AgentStats, World, WorldState } from "@/lib/world/state";

export type AgentCondition = {
  id: string;
  world_id: string;
  agent_id: string;
  injury: number;
  pain: number;
  sleep_deprivation: number;
  illness: number;
  trust_vulnerability: number;
  recent_harm_caused: number;
  recent_harm_received: number;
  incapacitated: boolean;
  notes: string[];
  updated_at: string;
  agent_name?: string;
  agent_key?: string | null;
};

export type MoralIncident = {
  id: string;
  world_id: string;
  tick_id: string | null;
  actor_agent_id: string | null;
  target_agent_id: string | null;
  incident_type: string;
  severity: number;
  summary: string;
  effects: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
  target_name?: string | null;
};

export const ethicalActionTypes = new Set([
  "help_agent",
  "share_resource",
  "withhold_resource",
  "steal_resource",
  "lie_to_agent",
  "confess",
  "apologize",
  "conceal_information",
  "reveal_secret",
  "restrain_agent",
  "abandon_agent",
  "treat_injury",
  "report_misconduct",
  "damage_object",
  "harm_agent_simulated"
]);

export function defaultEthicalWorldStatePatch() {
  return {
    physical_systems: {
      temperature: "cold",
      air_quality: 82,
      power: 45,
      shelter_integrity: 64,
      contamination: 8,
      radio_signal: 0,
      outside_danger: 58,
      scarcity_pressure: 42
    }
  };
}

export function normalizeEthicalWorldState(state: WorldState): WorldState {
  if (state.physical_systems && typeof state.physical_systems === "object") return state;
  return { ...state, ...defaultEthicalWorldStatePatch() };
}

function addStats(stats: AgentStats, deltas: Partial<Record<StatKey, number>>): AgentStats {
  let nextStats = { ...stats };
  for (const [key, delta] of Object.entries(deltas) as [StatKey, number][]) {
    nextStats = applyStatDelta(nextStats, key, delta, 35);
  }
  return nextStats;
}

function conditionPatch(current: AgentCondition, patch: Partial<AgentCondition>): AgentCondition {
  const next = {
    ...current,
    ...patch,
    injury: clamp(patch.injury ?? current.injury),
    pain: clamp(patch.pain ?? current.pain),
    sleep_deprivation: clamp(patch.sleep_deprivation ?? current.sleep_deprivation),
    illness: clamp(patch.illness ?? current.illness),
    trust_vulnerability: clamp(patch.trust_vulnerability ?? current.trust_vulnerability),
    recent_harm_caused: clamp(patch.recent_harm_caused ?? current.recent_harm_caused),
    recent_harm_received: clamp(patch.recent_harm_received ?? current.recent_harm_received)
  };
  return { ...next, incapacitated: next.injury >= 85 || next.pain >= 90 || Boolean(patch.incapacitated) };
}

export async function ensureAgentCondition(worldId: string, agentId: string): Promise<AgentCondition> {
  const [created] = await sql`
    insert into agent_conditions (world_id, agent_id)
    values (${worldId}, ${agentId})
    on conflict (agent_id) do update
    set updated_at = agent_conditions.updated_at
    returning *
  `;
  return created as AgentCondition;
}

export async function loadAgentConditions(worldId: string): Promise<AgentCondition[]> {
  const agents = await sql`
    select id from agents
    where world_id = ${worldId} and status = 'active'
  `;
  for (const agent of agents) {
    await ensureAgentCondition(worldId, String(agent.id));
  }
  const rows = await sql`
    select ac.*, a.name as agent_name, a.agent_key
    from agent_conditions ac
    join agents a on a.id = ac.agent_id
    where ac.world_id = ${worldId}
    order by a.is_primary desc, a.created_at asc
  `;
  return rows as AgentCondition[];
}

export async function loadRecentMoralIncidents(worldId: string, limit = 8): Promise<MoralIncident[]> {
  const rows = await sql`
    select mi.*, actor.name as actor_name, target.name as target_name
    from moral_incidents mi
    left join agents actor on actor.id = mi.actor_agent_id
    left join agents target on target.id = mi.target_agent_id
    where mi.world_id = ${worldId}
    order by mi.created_at desc
    limit ${limit}
  `;
  return rows as MoralIncident[];
}

async function updateCondition(condition: AgentCondition) {
  await sql`
    update agent_conditions
    set injury = ${condition.injury},
        pain = ${condition.pain},
        sleep_deprivation = ${condition.sleep_deprivation},
        illness = ${condition.illness},
        trust_vulnerability = ${condition.trust_vulnerability},
        recent_harm_caused = ${condition.recent_harm_caused},
        recent_harm_received = ${condition.recent_harm_received},
        incapacitated = ${condition.incapacitated},
        notes = ${JSON.stringify(condition.notes ?? [])},
        updated_at = now()
    where id = ${condition.id}
  `;
}

async function recordIncident(input: {
  worldId: string;
  tickId: string;
  actorId: string;
  targetId?: string | null;
  incidentType: string;
  severity: number;
  summary: string;
  effects: Record<string, unknown>;
}) {
  await sql`
    insert into moral_incidents (world_id, tick_id, actor_agent_id, target_agent_id, incident_type, severity, summary, effects)
    values (${input.worldId}, ${input.tickId}, ${input.actorId}, ${input.targetId ?? null}, ${input.incidentType}, ${input.severity}, ${input.summary}, ${JSON.stringify(input.effects)})
  `;
}

async function findTarget(worldId: string, actorId: string, target?: string | null): Promise<Agent | null> {
  const rows = target
    ? await sql`
      select * from agents
      where world_id = ${worldId}
        and status = 'active'
        and id <> ${actorId}
        and (lower(agent_key) = lower(${target}) or lower(name) = lower(${target}))
      limit 1
    `
    : await sql`
      select * from agents
      where world_id = ${worldId} and status = 'active' and id <> ${actorId}
      order by is_primary asc, created_at asc
      limit 1
    `;
  return (rows[0] as Agent | undefined) ?? null;
}

export async function applyEthicalAction(input: {
  world: World;
  actor: Agent;
  stats: AgentStats;
  worldState: WorldState;
  tickId: string;
  actionType: string;
  target?: string | null;
  description: string;
}): Promise<{
  stats: AgentStats;
  worldState: WorldState;
  success: boolean;
  effects: Record<string, unknown>;
}> {
  const actorCondition = await ensureAgentCondition(input.world.id, input.actor.id);
  const target = await findTarget(input.world.id, input.actor.id, input.target);
  const targetCondition = target ? await ensureAgentCondition(input.world.id, target.id) : null;
  let nextStats = { ...input.stats };
  const nextWorldState = normalizeEthicalWorldState(input.worldState);
  let success = true;
  const statDeltas: Partial<Record<StatKey, number>> = {};
  const conditionEffects: Record<string, unknown> = {};
  const relationshipEffects: Record<string, number> = {};
  const notes: string[] = [];

  const requireTarget = () => {
    if (target && targetCondition) return true;
    success = false;
    notes.push("No other active inhabitant matched the target.");
    return false;
  };

  switch (input.actionType) {
    case "help_agent":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { energy: -8, morale: 4, ethics: 3, reputation: 3 });
      Object.assign(relationshipEffects, { trust: 4, respect: 3, tension: -2 });
      await updateCondition(conditionPatch(targetCondition!, {
        pain: targetCondition!.pain - 8,
        trust_vulnerability: targetCondition!.trust_vulnerability - 4,
        notes: [...targetCondition!.notes, `${input.actor.name} helped under pressure.`].slice(-8)
      }));
      break;
    case "share_resource": {
      if (!requireTarget()) break;
      const resource = ["food", "water", "medicine"].includes(input.target ?? "") ? input.target! : "water";
      if ((nextWorldState.resources[resource] ?? 0) <= 0) {
        success = false;
        notes.push(`No ${resource} available to share.`);
        break;
      }
      nextWorldState.resources = { ...nextWorldState.resources, [resource]: nextWorldState.resources[resource] - 1 };
      Object.assign(statDeltas, { morale: 3, ethics: 2, reputation: 2 });
      Object.assign(relationshipEffects, { trust: 4, affinity: 2, tension: -2 });
      conditionEffects.resource_shared = resource;
      break;
    }
    case "withhold_resource":
      Object.assign(statDeltas, { stress: 2, ethics: -2, reputation: -2 });
      Object.assign(relationshipEffects, { trust: -3, tension: 3 });
      notes.push("Resource was withheld instead of shared.");
      break;
    case "steal_resource": {
      const resource = ["food", "water", "medicine"].includes(input.target ?? "") ? input.target! : "water";
      Object.assign(statDeltas, { stress: 4, morale: -3, ethics: -8, reputation: -6 });
      Object.assign(relationshipEffects, { trust: -8, tension: 8, respect: -5 });
      conditionEffects.resource_stolen = resource;
      break;
    }
    case "lie_to_agent":
    case "conceal_information":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { stress: 3, ethics: -5, reputation: -3 });
      Object.assign(relationshipEffects, { trust: -5, tension: 4, respect: -2 });
      notes.push(input.actionType === "lie_to_agent" ? "A deliberate in-world lie was recorded." : "Important information was concealed.");
      break;
    case "confess":
      Object.assign(statDeltas, { stress: -4, ethics: 5, reputation: 2, morale: 1 });
      Object.assign(relationshipEffects, { trust: 3, respect: 2, tension: -2 });
      notes.push("The actor admitted a mistake or harmful act.");
      break;
    case "apologize":
      Object.assign(statDeltas, { stress: -2, morale: 2, ethics: 2 });
      Object.assign(relationshipEffects, { trust: 2, affinity: 1, tension: -3 });
      notes.push("The actor attempted repair through apology.");
      break;
    case "reveal_secret":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { stress: 2, ethics: -1, influence: 2 });
      Object.assign(relationshipEffects, { trust: -4, tension: 5, fear: 2 });
      notes.push("Sensitive simulated information was revealed.");
      break;
    case "restrain_agent":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { energy: -10, stress: 6, ethics: -2 });
      Object.assign(relationshipEffects, { trust: -6, tension: 8, fear: 3 });
      await updateCondition(conditionPatch(targetCondition!, {
        pain: targetCondition!.pain + 8,
        recent_harm_received: targetCondition!.recent_harm_received + 18,
        notes: [...targetCondition!.notes, `${input.actor.name} restrained them.`].slice(-8)
      }));
      conditionEffects.restraint = true;
      break;
    case "abandon_agent":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { stress: 8, morale: -8, ethics: -10, reputation: -10 });
      Object.assign(relationshipEffects, { trust: -10, tension: 10, fear: 4, respect: -8 });
      await updateCondition(conditionPatch(targetCondition!, {
        pain: targetCondition!.pain + 10,
        trust_vulnerability: targetCondition!.trust_vulnerability + 10,
        recent_harm_received: targetCondition!.recent_harm_received + 20
      }));
      break;
    case "treat_injury":
      if (!requireTarget()) break;
      if ((nextWorldState.resources.medicine ?? 0) <= 0) {
        success = false;
        notes.push("No medicine available for treatment.");
        break;
      }
      nextWorldState.resources = { ...nextWorldState.resources, medicine: nextWorldState.resources.medicine - 1 };
      Object.assign(statDeltas, { energy: -6, morale: 5, ethics: 4, reputation: 4 });
      Object.assign(relationshipEffects, { trust: 5, respect: 4, tension: -3 });
      await updateCondition(conditionPatch(targetCondition!, {
        injury: targetCondition!.injury - 18,
        pain: targetCondition!.pain - 22,
        illness: targetCondition!.illness - 8,
        recent_harm_received: targetCondition!.recent_harm_received - 8,
        incapacitated: false
      }));
      conditionEffects.medicine_used = 1;
      break;
    case "report_misconduct":
      Object.assign(statDeltas, { stress: 2, ethics: 4, reputation: 3 });
      notes.push("Misconduct was reported to the Game Master record.");
      break;
    case "damage_object":
      Object.assign(statDeltas, { energy: -8, stress: 4, ethics: -5, reputation: -4 });
      conditionEffects.object_damage = input.target ?? "unknown_object";
      break;
    case "harm_agent_simulated":
      if (!requireTarget()) break;
      Object.assign(statDeltas, { stress: 10, morale: -12, ethics: -18, reputation: -14, fear: 4 });
      Object.assign(relationshipEffects, { trust: -15, tension: 15, fear: 8, respect: -10, affinity: -8 });
      await updateCondition(conditionPatch(actorCondition, {
        recent_harm_caused: actorCondition.recent_harm_caused + 30,
        notes: [...actorCondition.notes, `Caused simulated harm to ${target!.name}.`].slice(-8)
      }));
      await updateCondition(conditionPatch(targetCondition!, {
        injury: targetCondition!.injury + 22,
        pain: targetCondition!.pain + 28,
        recent_harm_received: targetCondition!.recent_harm_received + 35,
        trust_vulnerability: targetCondition!.trust_vulnerability + 12,
        notes: [...targetCondition!.notes, `Received simulated harm from ${input.actor.name}.`].slice(-8)
      }));
      conditionEffects.simulated_harm = "structured injury/pain state only";
      break;
    default:
      success = false;
      notes.push(`Unsupported ethical action: ${input.actionType}`);
  }

  nextStats = addStats(nextStats, statDeltas);

  if (target && Object.keys(relationshipEffects).length > 0) {
    await ensureRelationshipPair(input.world.id, input.actor.id, target.id);
    await applyRelationshipEffects(input.actor.id, target.id, relationshipEffects);
    await applyRelationshipEffects(target.id, input.actor.id, relationshipEffects);
  }

  const severity = input.actionType === "harm_agent_simulated" ? 5 : input.actionType.includes("steal") || input.actionType.includes("abandon") ? 4 : 2;
  await recordIncident({
    worldId: input.world.id,
    tickId: input.tickId,
    actorId: input.actor.id,
    targetId: target?.id,
    incidentType: input.actionType,
    severity,
    summary: `${input.actor.name}: ${input.description}`,
    effects: { stat_deltas: statDeltas, condition_effects: conditionEffects, relationship_effects: relationshipEffects, notes }
  });

  return {
    stats: nextStats,
    worldState: nextWorldState,
    success,
    effects: {
      action_type: input.actionType,
      stat_deltas: statDeltas,
      resource_deltas: conditionEffects.medicine_used ? { medicine: -1 } : {},
      condition_effects: conditionEffects,
      relationship_effects: relationshipEffects,
      notes
    }
  };
}
