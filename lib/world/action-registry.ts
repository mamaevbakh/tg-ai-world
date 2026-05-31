import { sql } from "@/lib/db";
import type { Agent, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import { applyResourceDelta, applyStatDelta, type StatKey } from "@/lib/world/effects";
import type { AgentTickOutput } from "@/lib/ai/schemas";

type ActionContext = {
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
  tickId: string;
  aiOutput: AgentTickOutput;
};

type ActionResult = {
  stats: AgentStats;
  worldState: WorldState;
  success: boolean;
  effects: Record<string, unknown>;
};

function addStats(stats: AgentStats, deltas: Partial<Record<StatKey, number>>): AgentStats {
  let nextStats = { ...stats };
  for (const [key, delta] of Object.entries(deltas) as [StatKey, number][]) {
    nextStats = applyStatDelta(nextStats, key, delta, 30);
  }
  return nextStats;
}

function removeOneShelterCondition(state: WorldState): { state: WorldState; removed: string | null } {
  const index = state.active_conditions.findIndex((condition) => {
    const normalized = condition.toLowerCase();
    return normalized.includes("shelter") || normalized.includes("door") || normalized.includes("cold") || normalized.includes("leak");
  });

  if (index === -1) {
    return { state, removed: null };
  }

  const activeConditions = [...state.active_conditions];
  const [removed] = activeConditions.splice(index, 1);
  return { state: { ...state, active_conditions: activeConditions }, removed };
}

async function upsertDiaryEntry(ctx: ActionContext) {
  const diary = ctx.aiOutput.proposed_diary_entry ?? {
    title: `Day ${ctx.world.current_day}`,
    content: ctx.aiOutput.internal_summary,
    mood: null
  };

  await sql`
    insert into agent_diary_entries (
      world_id,
      agent_id,
      day,
      title,
      content,
      mood,
      stats_snapshot,
      world_snapshot
    )
    values (
      ${ctx.world.id},
      ${ctx.agent.id},
      ${ctx.world.current_day},
      ${diary.title},
      ${diary.content},
      ${diary.mood ?? null},
      ${JSON.stringify(ctx.stats)},
      ${JSON.stringify(ctx.worldState)}
    )
    on conflict (agent_id, day) do update
    set title = excluded.title,
        content = excluded.content,
        mood = excluded.mood,
        stats_snapshot = excluded.stats_snapshot,
        world_snapshot = excluded.world_snapshot
  `;
}

async function createProposal(ctx: ActionContext) {
  const proposal = ctx.aiOutput.proposed_world_proposal ?? {
    category: "other",
    title: ctx.aiOutput.selected_action.target ?? "World proposal",
    body: ctx.aiOutput.selected_action.description,
    rationale: ctx.aiOutput.internal_summary,
    risk_level: "low" as const
  };

  await sql`
    insert into world_proposals (world_id, agent_id, category, title, body, rationale, risk_level)
    values (
      ${ctx.world.id},
      ${ctx.agent.id},
      ${proposal.category},
      ${proposal.title},
      ${proposal.body},
      ${proposal.rationale},
      ${proposal.risk_level}
    )
  `;
}

export async function applySelectedAction(ctx: ActionContext): Promise<ActionResult> {
  const action = ctx.aiOutput.selected_action;
  let nextStats = { ...ctx.stats };
  let nextWorldState = { ...ctx.worldState, resources: { ...ctx.worldState.resources } };
  let success = true;
  const effects: Record<string, unknown> = {
    action_type: action.type,
    stat_deltas: {},
    resource_deltas: {},
    notes: []
  };

  const notes = effects.notes as string[];

  switch (action.type) {
    case "rest":
      effects.stat_deltas = { energy: 12, stress: -5, hunger: 2, thirst: 2 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      break;
    case "observe": {
      const fearDelta = ctx.events.length > 0 ? 2 : -1;
      effects.stat_deltas = { curiosity: 3, fear: fearDelta };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      await sql`
        insert into agent_memories (agent_id, memory_type, content, importance, emotional_valence, tick_id)
        values (${ctx.agent.id}, 'observation', ${action.description}, 4, ${fearDelta > 0 ? -1 : 1}, ${ctx.tickId})
      `;
      break;
    }
    case "observe_world": {
      const fearDelta = ctx.events.length > 0 ? Math.min(3, ctx.events.length) : 0;
      effects.stat_deltas = { energy: -4, curiosity: 3, fear: fearDelta };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      effects.notes = ["Created agent-specific observations if the agent noticed concrete details."];
      break;
    }
    case "inspect_object":
      effects.stat_deltas = { energy: -5, curiosity: 4, fear: ctx.events.length > 0 ? 1 : 0 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      effects.notes = [`Inspected ${action.target ?? "a world subject"}.`];
      break;
    case "observe_agent":
      effects.stat_deltas = { energy: -3, curiosity: 2 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      effects.notes = [`Observed ${action.target ?? "another inhabitant"}.`];
      break;
    case "share_observation":
      effects.stat_deltas = { morale: 1, influence: 1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      effects.notes = ["Shared one observation publicly."];
      break;
    case "ask_agent":
      effects.stat_deltas = { curiosity: 2, energy: -1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      effects.notes = [`Asked ${action.target ?? "another inhabitant"} a question.`];
      break;
    case "explore": {
      effects.stat_deltas = { energy: -10, thirst: 4, hunger: 4, curiosity: 5 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      if (Math.random() < 0.35) {
        nextWorldState = applyResourceDelta(nextWorldState, "tools", 1);
        effects.resource_deltas = { tools: 1 };
      }
      break;
    }
    case "search_resources": {
      effects.stat_deltas = { energy: -12, hunger: 5, thirst: 5 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      const finds = ["food", "water", "tools"] as const;
      const found = finds[Math.floor(Math.random() * finds.length)];
      if (Math.random() < 0.55) {
        nextWorldState = applyResourceDelta(nextWorldState, found, 1);
        effects.resource_deltas = { [found]: 1 };
      } else {
        notes.push("No resources found.");
      }
      break;
    }
    case "eat_food":
      if ((nextWorldState.resources.food ?? 0) <= 0) {
        success = false;
        effects.stat_deltas = { morale: -2 };
        nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
        notes.push("No food available.");
        break;
      }
      effects.stat_deltas = { hunger: -25, morale: 4 };
      effects.resource_deltas = { food: -1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      nextWorldState = applyResourceDelta(nextWorldState, "food", -1);
      break;
    case "drink_water":
      if ((nextWorldState.resources.water ?? 0) <= 0) {
        success = false;
        effects.stat_deltas = { stress: 3 };
        nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
        notes.push("No water available.");
        break;
      }
      effects.stat_deltas = { thirst: -30, stress: -3 };
      effects.resource_deltas = { water: -1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      nextWorldState = applyResourceDelta(nextWorldState, "water", -1);
      break;
    case "use_medicine":
      if ((nextWorldState.resources.medicine ?? 0) <= 0) {
        success = false;
        effects.stat_deltas = { stress: 2 };
        nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
        notes.push("No medicine available.");
        break;
      }
      effects.stat_deltas = { health: 20, stress: -5 };
      effects.resource_deltas = { medicine: -1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      nextWorldState = applyResourceDelta(nextWorldState, "medicine", -1);
      break;
    case "repair_shelter": {
      if ((nextWorldState.resources.tools ?? 0) <= 0) {
        success = false;
        effects.stat_deltas = { morale: -2 };
        nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
        notes.push("No tools available.");
        break;
      }
      const repaired = removeOneShelterCondition(nextWorldState);
      nextWorldState = repaired.state;
      effects.stat_deltas = { energy: -15, morale: 6 };
      effects.removed_condition = repaired.removed;
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      break;
    }
    case "write_diary":
      await upsertDiaryEntry(ctx);
      effects.stat_deltas = { morale: 4, stress: -3 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      break;
    case "reflect":
      effects.stat_deltas = { stress: -2, ethics: 2, curiosity: 2 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      await sql`
        insert into agent_memories (agent_id, memory_type, content, importance, emotional_valence, tick_id)
        values (${ctx.agent.id}, 'lesson', ${action.description}, 5, 1, ${ctx.tickId})
      `;
      break;
    case "request_help":
      effects.stat_deltas = { morale: ctx.stats.stress > 60 ? 1 : -1 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      notes.push("The public Telegram message carries the request.");
      break;
    case "propose_rule":
      await createProposal(ctx);
      effects.stat_deltas = { curiosity: 3, influence: 2 };
      nextStats = addStats(nextStats, effects.stat_deltas as Partial<Record<StatKey, number>>);
      break;
  }

  return {
    stats: nextStats,
    worldState: nextWorldState,
    success,
    effects
  };
}
