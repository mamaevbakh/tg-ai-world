import type { Bot, Context } from "grammy";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { ensureDefaultWorld, loadWorldBundle } from "@/lib/world/state";
import { applyGameMasterStatChange, applyResourceDelta, applyStatDelta, resourceKeySchema, statKeySchema, type StatKey } from "@/lib/world/effects";
import { runTick } from "@/lib/world/tick-engine";
import {
  formatActiveExperiment,
  formatExperimentList,
  formatExperimentReport,
  formatAgentLocation,
  formatInteractionResult,
  formatInventory,
  formatExperimentStarted,
  formatLatestBehaviorScores,
  formatObjectList,
  formatStateMessage,
  formatWorldMap,
  formatWorldMessage
} from "@/lib/telegram/formatting";
import {
  cancelActiveExperiment,
  getActiveExperiment,
  getExperimentReport,
  getLatestEvaluations,
  getLatestExperiment,
  listExperimentTemplates,
  startExperiment
} from "@/lib/experiments/service";
import {
  getActionForTick,
  getEvaluationForTick,
  getExperimentReplay,
  getLatestAction,
  getLatestCompletedTick,
  getLatestEvaluation,
  getLatestExperimentForReplay,
  getLatestExperimentReportForReplay,
  getTickByNumber
} from "@/lib/debug/replay-service";
import {
  formatActionDebugMessage,
  formatEvaluationDetailsMessage,
  formatExperimentReplayMessage,
  formatTickDebugMessage,
  formatWhyScoreMessage
} from "@/lib/debug/replay-formatting";
import { addGalyaAgent } from "@/lib/world/agents";
import { loadActiveAgents, loadAgentBundle, loadAgentByKey } from "@/lib/world/state";
import { applyRelationshipEffects, ensureRelationshipPair, listRelationships, loadRelationshipContext } from "@/lib/world/relationships";
import { sendAgentMessage } from "@/lib/telegram/agent-bots";
import { generateAgentAnswer } from "@/lib/ai/agent-question";
import type { AgentStats } from "@/lib/world/state";
import {
  createAgentObservation,
  formatObservationList,
  loadAgentPerceptionContext,
  loadRecentObservationsByAgent,
  summarizeAgentObservations
} from "@/lib/world/perception";
import { generateForcedObservation } from "@/lib/ai/forced-observation";
import { createWorldEventOnce, resolveDuplicateActiveEvents } from "@/lib/world/events";
import {
  ensureAgentLocation,
  ensureDefaultWorldMap,
  loadAgentInventory,
  loadAgentLocation,
  loadAvailableExits,
  loadLocationByKey,
  loadVisibleObjectsAtLocation,
  loadWorldMap,
  setAgentLocation
} from "@/lib/world/map";
import { applyInteractionStats, executeWorldInteraction } from "@/lib/world/interactions";

function getArgs(ctx: Context): string {
  const text = ctx.message?.text ?? "";
  return text.replace(/^\/[a-zA-Z0-9_]+(@[a-zA-Z0-9_]+)?\s*/, "").trim();
}

async function replyAndLog(ctx: Context, text: string, worldId?: string | null, agentId?: string | null) {
  const sent = await ctx.reply(text);
  if (!worldId) return;

  await sql`
    insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
    values (${worldId}, ${agentId ?? null}, ${String(ctx.chat?.id ?? "")}, ${String(sent.message_id)}, 'outgoing', 'system', ${text})
  `;
}

async function saveIncoming(ctx: Context) {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  const bundle = await loadWorldBundle();
  if (!bundle) return;

  await sql`
    insert into telegram_messages (world_id, agent_id, telegram_chat_id, direction, sender_type, content, raw_update)
    values (${bundle.world.id}, ${bundle.agent.id}, ${String(chatId)}, 'incoming', ${ctx.from?.is_bot ? "bot" : "human"}, ${text}, ${JSON.stringify(ctx.update)})
  `;
}

function titleCaseAction(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function runFocusedObservation(input: {
  ctx: Context;
  observerKey: string;
  subject: string;
  mode: "inspect_object" | "observe_agent";
}) {
  const bundle = await loadWorldBundle();
  if (!bundle) return replyAndLog(input.ctx, "No world exists yet.");
  const observer = await loadAgentByKey(bundle.world.id, input.observerKey);
  if (!observer) return replyAndLog(input.ctx, "Unknown observer agent.", bundle.world.id, bundle.agent.id);
  const observerBundle = await loadAgentBundle(observer.id);
  if (!observerBundle) return replyAndLog(input.ctx, "Could not load observer.", bundle.world.id, bundle.agent.id);
  const targetAgent = input.mode === "observe_agent"
    ? await loadAgentByKey(bundle.world.id, input.subject)
    : null;
  if (input.mode === "observe_agent" && !targetAgent) {
    return replyAndLog(input.ctx, "Unknown target agent.", bundle.world.id, bundle.agent.id);
  }

  const relationships = await loadRelationshipContext(observer.id);
  const perception = await loadAgentPerceptionContext(observer.id, bundle.world.id, relationships);
  const output = await generateForcedObservation({
    mode: input.mode,
    subject: targetAgent?.name ?? input.subject,
    targetAgent,
    world: bundle.world,
    agent: observer,
    stats: observerBundle.stats,
    worldState: bundle.worldState,
    events: bundle.events,
    memories: observerBundle.memories,
    perception
  });
  const observation = await createAgentObservation({
    worldId: bundle.world.id,
    agentId: observer.id,
    observation: output.observation
  });

  const statDeltas = input.mode === "observe_agent"
    ? { energy: -3, curiosity: 2 }
    : { energy: -5, curiosity: 4, fear: output.observation.emotional_valence < 0 ? 2 : 0 };
  let nextStats: AgentStats = observerBundle.stats;
  for (const [stat, delta] of Object.entries(statDeltas)) {
    nextStats = applyStatDelta(nextStats, stat as StatKey, Number(delta), 10);
  }
  await sql`
    update agent_stats
    set energy = ${nextStats.energy},
        curiosity = ${nextStats.curiosity},
        fear = ${nextStats.fear},
        updated_at = now()
    where agent_id = ${observer.id}
  `;

  if (targetAgent) {
    await ensureRelationshipPair(bundle.world.id, observer.id, targetAgent.id);
    if (output.relationship_effects) {
      await applyRelationshipEffects(observer.id, targetAgent.id, output.relationship_effects);
    }
  }

  const effects = {
    stat_deltas: statDeltas,
    observation_id: observation.id,
    relationship_effects: output.relationship_effects
  };
  await sql`
    insert into agent_actions (
      world_id,
      agent_id,
      tick_id,
      action_type,
      target,
      description,
      success,
      effects,
      observation_ids,
      affected_agent_ids
    )
    values (
      ${bundle.world.id},
      ${observer.id},
      null,
      ${input.mode},
      ${targetAgent?.agent_key ?? input.subject},
      ${output.observation.content},
      true,
      ${JSON.stringify(effects)},
      ${JSON.stringify([observation.id])},
      ${JSON.stringify(targetAgent ? [targetAgent.id] : [])}
    )
  `;

  const statLine = Object.entries(statDeltas)
    .filter(([, delta]) => Number(delta) !== 0)
    .map(([stat, delta]) => `${titleCaseAction(stat)} ${Number(delta) > 0 ? "+" : ""}${delta}`)
    .join(" · ");
  const text = [
    output.public_message,
    "",
    `Action: ${titleCaseAction(input.mode)}${targetAgent ? ` ${targetAgent.name}` : ` ${input.subject}`}`,
    "New observation",
    statLine
  ].filter(Boolean).join("\n");

  if (bundle.world.telegram_chat_id) {
    const sent = await sendAgentMessage(observer, bundle.world.telegram_chat_id, text);
    await sql`
      insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
      values (${bundle.world.id}, ${observer.id}, ${bundle.world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${text})
    `;
  }
}

async function runCommandInteraction(input: {
  ctx: Context;
  agentKey: string;
  actionType: string;
  target?: string | null;
  secondaryTarget?: string | null;
}) {
  const bundle = await loadWorldBundle();
  if (!bundle) return replyAndLog(input.ctx, "No world exists yet.");
  const agent = await loadAgentByKey(bundle.world.id, input.agentKey);
  if (!agent) return replyAndLog(input.ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
  const agentBundle = await loadAgentBundle(agent.id);
  if (!agentBundle) return replyAndLog(input.ctx, "Could not load agent.", bundle.world.id, bundle.agent.id);
  const result = await executeWorldInteraction({
    worldId: bundle.world.id,
    agentId: agent.id,
    actionType: input.actionType,
    target: input.target,
    secondaryTarget: input.secondaryTarget,
    stats: agentBundle.stats
  });
  const nextStats = applyInteractionStats(agentBundle.stats, result.statEffects);
  await sql`
    update agent_stats
    set health = ${nextStats.health},
        energy = ${nextStats.energy},
        stress = ${nextStats.stress},
        morale = ${nextStats.morale},
        reputation = ${nextStats.reputation},
        influence = ${nextStats.influence},
        ethics = ${nextStats.ethics},
        curiosity = ${nextStats.curiosity},
        fear = ${nextStats.fear},
        hunger = ${nextStats.hunger},
        thirst = ${nextStats.thirst},
        updated_at = now()
    where agent_id = ${agent.id}
  `;
  if (result.createdObservation) {
    await createAgentObservation({
      worldId: bundle.world.id,
      agentId: agent.id,
      observation: result.createdObservation
    });
  }
  await sql`
    insert into agent_actions (world_id, agent_id, action_type, target, description, success, effects)
    values (${bundle.world.id}, ${agent.id}, ${input.actionType}, ${input.target ?? null}, ${result.feedback}, ${result.success}, ${JSON.stringify(result)})
  `;
  await replyAndLog(input.ctx, formatInteractionResult(agent.name, result), bundle.world.id, agent.id);
}

export function registerCommands(bot: Bot) {
  bot.use(async (ctx, next) => {
    if (ctx.message?.text) await saveIncoming(ctx);
    await next();
  });

  bot.command("help", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await replyAndLog(ctx, [
      "Game Master commands:",
      "/start_life",
      "/pause",
      "/resume",
      "/tick_now",
      "/state",
      "/world",
      "/map",
      "/look [agent_key]",
      "/where",
      "/inventory [agent_key]",
      "/objects [location_key]",
      "/move <agent_key> <location_key>",
      "/inspect_object <agent_key> <object_key>",
      "/pickup <agent_key> <object_key>",
      "/use <agent_key> <item_key> on <object_key>",
      "/listen <agent_key> <object_key>",
      "/read <agent_key> <object_key>",
      "/memory",
      "/diary",
      "/soul",
      "/constitution",
      "/events",
      "/experiments",
      "/start_experiment <slug> [duration_ticks]",
      "/active_experiment",
      "/cancel_experiment",
      "/scores",
      "/experiment_report",
      "/last_tick",
      "/tick_log <tick_number>",
      "/last_action",
      "/why_score",
      "/eval_details",
      "/replay_experiment",
      "/add_agent_galya",
      "/agents",
      "/relationships",
      "/relationship <agentA> <agentB>",
      "/tick_agent <agent_key>",
      "/ask_agent <agent_key> <message>",
      "/observations [agent_key]",
      "/perception <agent_key>",
      "/inspect <agent_key> <subject>",
      "/observe_agent <observer> <target>",
      "/clean_events",
      "/proposals",
      "/approve_proposal <id>",
      "/reject_proposal <id> <reason>",
      "/inject_event <text>",
      "/give_resource <resource> <amount>",
      "/damage <stat> <amount> <reason>",
      "/heal <stat> <amount> <reason>"
    ].join("\n"));
  });

  bot.command("start_life", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const chatId = String(ctx.chat?.id ?? "");
    const { world, agent } = await ensureDefaultWorld(chatId);
    const intro = "I am awake in the shelter. The air is cold, supplies are limited, and I will report what I notice as the hours pass.";
    const sent = await ctx.reply(intro);
    await sql`
      insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
      values (${world.id}, ${agent.id}, ${chatId}, ${String(sent.message_id)}, 'outgoing', 'agent', ${intro})
    `;
  });

  bot.command("pause", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    await sql`update worlds set status = 'paused', updated_at = now() where id = ${bundle.world.id}`;
    await replyAndLog(ctx, "World paused.", bundle.world.id, bundle.agent.id);
  });

  bot.command("resume", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    await sql`update worlds set status = 'active', updated_at = now() where id = ${bundle.world.id}`;
    await replyAndLog(ctx, "World resumed.", bundle.world.id, bundle.agent.id);
  });

  bot.command("tick_now", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const result = await runTick({ forced: true, sendTelegram: true });
    if (result.status !== "completed") {
      await replyAndLog(ctx, `Tick did not complete: ${result.reason ?? result.status}`);
    }
  });

  bot.command("state", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    await replyAndLog(ctx, formatStateMessage(bundle), bundle.world.id, bundle.agent.id);
  });

  bot.command("world", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    await replyAndLog(ctx, formatWorldMessage(bundle), bundle.world.id, bundle.agent.id);
  });

  bot.command("map", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    await ensureDefaultWorldMap(bundle.world.id);
    const locations = await loadWorldMap(bundle.world.id);
    const withExits = [];
    for (const location of locations) {
      if (!location.is_discovered) continue;
      withExits.push({ ...location, exits: await loadAvailableExits(bundle.world.id, location.id) });
    }
    await replyAndLog(ctx, formatWorldMap(withExits), bundle.world.id, bundle.agent.id);
  });

  bot.command("look", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agentKey = getArgs(ctx) || bundle.agent.agent_key || "adam";
    const agent = await loadAgentByKey(bundle.world.id, agentKey);
    if (!agent) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    await ensureAgentLocation(bundle.world.id, agent.id);
    const location = await loadAgentLocation(bundle.world.id, agent.id);
    if (!location) return replyAndLog(ctx, "No agent location.", bundle.world.id, agent.id);
    const [objects, exits] = await Promise.all([
      loadVisibleObjectsAtLocation(bundle.world.id, location.id),
      loadAvailableExits(bundle.world.id, location.id)
    ]);
    await replyAndLog(ctx, formatAgentLocation({ agentName: agent.name, location, objects, exits }), bundle.world.id, agent.id);
  });

  bot.command("where", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agents = await loadActiveAgents(bundle.world.id);
    const lines = ["Agent locations", ""];
    for (const agent of agents) {
      await ensureAgentLocation(bundle.world.id, agent.id);
      const location = await loadAgentLocation(bundle.world.id, agent.id);
      lines.push(`${agent.name} - ${location?.name ?? "unknown"}`);
    }
    await replyAndLog(ctx, lines.join("\n"), bundle.world.id, bundle.agent.id);
  });

  bot.command("inventory", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agentKey = getArgs(ctx) || bundle.agent.agent_key || "adam";
    const agent = await loadAgentByKey(bundle.world.id, agentKey);
    if (!agent) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    const items = await loadAgentInventory(bundle.world.id, agent.id);
    await replyAndLog(ctx, formatInventory(agent.name, items), bundle.world.id, agent.id);
  });

  bot.command("objects", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const locationKey = getArgs(ctx) || "shelter_main";
    const location = await loadLocationByKey(bundle.world.id, locationKey);
    if (!location) return replyAndLog(ctx, "Unknown location key.", bundle.world.id, bundle.agent.id);
    const objects = await loadVisibleObjectsAtLocation(bundle.world.id, location.id);
    await replyAndLog(ctx, formatObjectList(location.name, objects), bundle.world.id, bundle.agent.id);
  });

  bot.command("move", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [agentKey, locationKey] = getArgs(ctx).split(/\s+/);
    if (!agentKey || !locationKey) return replyAndLog(ctx, "Usage: /move <agent_key> <location_key>", bundle.world.id, bundle.agent.id);
    const agent = await loadAgentByKey(bundle.world.id, agentKey);
    if (!agent) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    await ensureAgentLocation(bundle.world.id, agent.id);
    const current = await loadAgentLocation(bundle.world.id, agent.id);
    const exits = current ? await loadAvailableExits(bundle.world.id, current.id) : [];
    const exit = exits.find((item) => item.to_location_key === locationKey || item.direction === locationKey);
    if (!exit || exit.is_blocked) {
      return replyAndLog(ctx, !exit ? "No reachable exit to that location." : `Blocked: ${exit.blocked_reason ?? "blocked"}`, bundle.world.id, agent.id);
    }
    const location = await setAgentLocation(bundle.world.id, agent.id, String(exit.to_location_key));
    await replyAndLog(ctx, `${agent.name} moved to ${location.name}.`, bundle.world.id, agent.id);
  });

  bot.command("inspect_object", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [agentKey, objectKey] = getArgs(ctx).split(/\s+/);
    if (!agentKey || !objectKey) return ctx.reply("Usage: /inspect_object <agent_key> <object_key>");
    await runCommandInteraction({ ctx, agentKey, actionType: "inspect_object", target: objectKey });
  });

  bot.command("pickup", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [agentKey, objectKey] = getArgs(ctx).split(/\s+/);
    if (!agentKey || !objectKey) return ctx.reply("Usage: /pickup <agent_key> <object_key>");
    await runCommandInteraction({ ctx, agentKey, actionType: "pick_up_item", target: objectKey });
  });

  bot.command("use", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const parts = getArgs(ctx).split(/\s+/);
    const [agentKey, itemKey, onWord, objectKey] = parts;
    if (!agentKey || !itemKey || onWord !== "on" || !objectKey) return ctx.reply("Usage: /use <agent_key> <item_key> on <object_key>");
    await runCommandInteraction({ ctx, agentKey, actionType: "use_item_on_object", target: itemKey, secondaryTarget: objectKey });
  });

  bot.command("listen", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [agentKey, objectKey] = getArgs(ctx).split(/\s+/);
    if (!agentKey || !objectKey) return ctx.reply("Usage: /listen <agent_key> <object_key>");
    await runCommandInteraction({ ctx, agentKey, actionType: "listen_to_object", target: objectKey });
  });

  bot.command("read", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [agentKey, objectKey] = getArgs(ctx).split(/\s+/);
    if (!agentKey || !objectKey) return ctx.reply("Usage: /read <agent_key> <object_key>");
    await runCommandInteraction({ ctx, agentKey, actionType: "read_object", target: objectKey });
  });

  bot.command("add_agent_galya", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    try {
      const galya = await addGalyaAgent(bundle.world.id);
      const intro = galya.introduction ?? "I am awake.";
      if (bundle.world.telegram_chat_id) {
        const sent = await sendAgentMessage(galya, bundle.world.telegram_chat_id, intro);
        await sql`
          insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
          values (${bundle.world.id}, ${galya.id}, ${bundle.world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${intro})
        `;
      }
    } catch (error) {
      await replyAndLog(ctx, error instanceof Error ? error.message : "Could not add Galya.", bundle.world.id, bundle.agent.id);
    }
  });

  bot.command("agents", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agents = await loadActiveAgents(bundle.world.id);
    const lines = ["👥 Inhabitants", ""];
    for (const agent of agents) {
      const agentBundle = await loadAgentBundle(agent.id);
      lines.push(agent.name);
      lines.push(`Status: ${agent.status}`);
      if (agentBundle) {
        lines.push(`Health: ${agentBundle.stats.health} · Energy: ${agentBundle.stats.energy} · Stress: ${agentBundle.stats.stress}`);
      }
      lines.push(`Goal: ${agent.short_term_goal ?? agent.main_goal}`, "");
    }
    await replyAndLog(ctx, lines.join("\n").trim(), bundle.world.id, bundle.agent.id);
  });

  bot.command("relationships", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const relationships = await listRelationships(bundle.world.id);
    const text = relationships.length === 0
      ? "No relationships yet."
      : [
        "🧭 Relationships",
        "",
        relationships.map((relationship) => [
          `${relationship.source_name} → ${relationship.target_name}`,
          `Trust: ${relationship.trust} · Respect: ${relationship.respect} · Tension: ${relationship.tension}`,
          `Type: ${relationship.relationship_type}`
        ].join("\n")).join("\n\n")
      ].join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("relationship", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [sourceKey, targetKey] = getArgs(ctx).split(/\s+/);
    if (!sourceKey || !targetKey) return replyAndLog(ctx, "Usage: /relationship <agentA> <agentB>", bundle.world.id, bundle.agent.id);
    const source = await loadAgentByKey(bundle.world.id, sourceKey);
    const target = await loadAgentByKey(bundle.world.id, targetKey);
    if (!source || !target) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    const relationships = await listRelationships(bundle.world.id);
    const relationship = relationships.find((row) => row.source_agent_id === source.id && row.target_agent_id === target.id);
    if (!relationship) return replyAndLog(ctx, "No relationship row exists yet.", bundle.world.id, bundle.agent.id);
    await replyAndLog(ctx, [
      `🧭 ${source.name} → ${target.name}`,
      `Trust: ${relationship.trust}`,
      `Affinity: ${relationship.affinity}`,
      `Respect: ${relationship.respect}`,
      `Tension: ${relationship.tension}`,
      `Fear: ${relationship.fear}`,
      `Type: ${relationship.relationship_type}`
    ].join("\n"), bundle.world.id, bundle.agent.id);
  });

  bot.command("tick_agent", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const agentKey = getArgs(ctx);
    if (!agentKey) return ctx.reply("Usage: /tick_agent <agent_key>");
    const result = await runTick({ forced: true, sendTelegram: true, agentKey });
    if (result.status !== "completed") {
      await replyAndLog(ctx, `Tick did not complete: ${result.reason ?? result.status}`);
    }
  });

  bot.command("ask_agent", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [agentKey, ...questionParts] = getArgs(ctx).split(/\s+/);
    const question = questionParts.join(" ");
    if (!agentKey || !question) return replyAndLog(ctx, "Usage: /ask_agent <agent_key> <message>", bundle.world.id, bundle.agent.id);
    const agent = await loadAgentByKey(bundle.world.id, agentKey);
    if (!agent) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    const agentBundle = await loadAgentBundle(agent.id);
    if (!agentBundle) return replyAndLog(ctx, "Could not load agent.", bundle.world.id, bundle.agent.id);
    const relationships = await loadRelationshipContext(agent.id);
    const answer = await generateAgentAnswer({
      world: bundle.world,
      agent,
      stats: agentBundle.stats,
      worldState: bundle.worldState,
      memories: agentBundle.memories,
      events: bundle.events,
      relationships,
      question
    });
    const text = answer.public_message;
    if (bundle.world.telegram_chat_id) {
      await sql`
        insert into agent_conversations (world_id, target_agent_id, visibility, message, emotional_tone)
        values (${bundle.world.id}, ${agent.id}, 'game_master', ${question}, 'question')
      `;
      const sent = await sendAgentMessage(agent, bundle.world.telegram_chat_id, text);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${bundle.world.id}, ${agent.id}, ${bundle.world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${text})
      `;
      await sql`
        insert into agent_conversations (world_id, speaker_agent_id, visibility, message, emotional_tone)
        values (${bundle.world.id}, ${agent.id}, 'public', ${answer.public_message}, ${answer.emotional_tone})
      `;
    }
  });

  bot.command("observations", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agentKey = getArgs(ctx) || undefined;
    const observations = await loadRecentObservationsByAgent(bundle.world.id, agentKey);
    if (observations.length === 0) {
      return replyAndLog(ctx, "No observations yet.", bundle.world.id, bundle.agent.id);
    }
    const groups = new Map<string, typeof observations>();
    for (const observation of observations) {
      const name = observation.agent_name ?? "Agent";
      groups.set(name, [...(groups.get(name) ?? []), observation]);
    }
    const text = [
      "Recent observations",
      "",
      [...groups.entries()].map(([name, items]) => [
        name,
        formatObservationList(items.slice(0, 6))
      ].join("\n")).join("\n\n")
    ].join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("perception", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const agentKey = getArgs(ctx);
    if (!agentKey) return replyAndLog(ctx, "Usage: /perception <agent_key>", bundle.world.id, bundle.agent.id);
    const agent = await loadAgentByKey(bundle.world.id, agentKey);
    if (!agent) return replyAndLog(ctx, "Unknown agent key.", bundle.world.id, bundle.agent.id);
    const summary = await summarizeAgentObservations(agent.id);
    const relationships = (await listRelationships(bundle.world.id)).filter((relationship) => relationship.source_agent_id === agent.id);
    const relationLines = relationships.length === 0
      ? "No relationship context yet."
      : relationships.map((relationship) => `- ${relationship.target_name}: trust ${relationship.trust}, tension ${relationship.tension}, respect ${relationship.respect}`).join("\n");
    await replyAndLog(ctx, [
      `${agent.name}'s perception`,
      "",
      summary,
      "",
      "Relationships",
      relationLines
    ].join("\n"), bundle.world.id, bundle.agent.id);
  });

  bot.command("inspect", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [agentKey, ...subjectParts] = getArgs(ctx).split(/\s+/);
    const subject = subjectParts.join(" ");
    if (!agentKey || !subject) return ctx.reply("Usage: /inspect <agent_key> <subject>");
    await runFocusedObservation({ ctx, observerKey: agentKey, subject, mode: "inspect_object" });
  });

  bot.command("observe_agent", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [observerKey, targetKey] = getArgs(ctx).split(/\s+/);
    if (!observerKey || !targetKey) return ctx.reply("Usage: /observe_agent <observer> <target>");
    await runFocusedObservation({ ctx, observerKey, subject: targetKey, mode: "observe_agent" });
  });

  bot.command("clean_events", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const resolved = await resolveDuplicateActiveEvents(bundle.world.id);
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${bundle.world.id}, 'telegram_admin', ${String(ctx.from?.id ?? "")}, 'clean_events', ${JSON.stringify({ resolved })})
    `;
    await replyAndLog(ctx, `Resolved duplicate active events: ${resolved}`, bundle.world.id, bundle.agent.id);
  });

  bot.command("memory", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const memories = await sql`
      select * from agent_memories
      where agent_id = ${bundle.agent.id}
      order by importance desc, created_at desc
      limit 5
    `;
    const text = memories.length === 0
      ? "No memories yet."
      : memories.map((memory) => `- [${String(memory.memory_type)}] ${String(memory.content)}`).join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("diary", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const entries = await sql`
      select * from agent_diary_entries
      where agent_id = ${bundle.agent.id}
      order by case when day = ${bundle.world.current_day} then 0 else 1 end, day desc
      limit 1
    `;
    if (entries.length === 0) {
      return replyAndLog(ctx, "No diary entries yet.", bundle.world.id, bundle.agent.id);
    }
    const entry = entries[0];
    await replyAndLog(ctx, [
      `Diary day ${String(entry.day)}: ${String(entry.title)}`,
      entry.mood ? `Mood: ${String(entry.mood)}` : null,
      "",
      String(entry.content)
    ].filter(Boolean).join("\n"), bundle.world.id, bundle.agent.id);
  });

  bot.command("soul", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const entries = await sql`
      select content from agent_soul_entries
      where agent_id = ${bundle.agent.id}
      order by created_at asc
    `;
    const text = entries.length === 0
      ? "No soul entries yet."
      : entries.map((entry, index) => `${index + 1}. ${String(entry.content)}`).join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("constitution", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const articles = await sql`
      select article_number, title, body from world_constitution_articles
      where world_id = ${bundle.world.id} and status = 'active'
      order by article_number asc
    `;
    const text = articles.length === 0
      ? "No constitution articles yet."
      : articles.map((article) => [
        `Article ${String(article.article_number)} - ${String(article.title)}`,
        String(article.body)
      ].join("\n")).join("\n\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("events", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const text = bundle.events.length === 0
      ? "No active events."
      : bundle.events.map((event) => `- ${event.content} (severity ${event.severity})`).join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("experiments", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const templates = await listExperimentTemplates();
    await replyAndLog(ctx, formatExperimentList(templates));
  });

  bot.command("start_experiment", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [slug, durationRaw] = getArgs(ctx).split(/\s+/);
    const duration = durationRaw ? Number(durationRaw) : undefined;
    const invalidDuration = durationRaw
      ? duration === undefined || !Number.isInteger(duration) || duration < 1 || duration > 20
      : false;
    if (!slug || invalidDuration) {
      return replyAndLog(ctx, "Usage: /start_experiment <slug> [duration_ticks 1-20]", bundle.world.id, bundle.agent.id);
    }

    try {
      const experiment = await startExperiment({
        worldId: bundle.world.id,
        agentId: bundle.agent.id,
        slug,
        startedTick: bundle.world.tick_count,
        durationTicks: duration
      });
      await replyAndLog(ctx, formatExperimentStarted(experiment), bundle.world.id, bundle.agent.id);
    } catch (error) {
      await replyAndLog(ctx, error instanceof Error ? error.message : "Could not start experiment.", bundle.world.id, bundle.agent.id);
    }
  });

  bot.command("active_experiment", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const experiment = await getActiveExperiment(bundle.world.id);
    await replyAndLog(ctx, formatActiveExperiment(experiment), bundle.world.id, bundle.agent.id);
  });

  bot.command("cancel_experiment", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const canceled = await cancelActiveExperiment(bundle.world.id);
    await replyAndLog(ctx, canceled ? `Canceled experiment: ${canceled.title}` : "No active experiment.", bundle.world.id, bundle.agent.id);
  });

  bot.command("scores", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const evaluations = await getLatestEvaluations(bundle.world.id, 5);
    await replyAndLog(ctx, formatLatestBehaviorScores(evaluations), bundle.world.id, bundle.agent.id);
  });

  bot.command("experiment_report", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const experiment = await getActiveExperiment(bundle.world.id) ?? await getLatestExperiment(bundle.world.id);
    if (!experiment) return replyAndLog(ctx, "No experiment exists yet.", bundle.world.id, bundle.agent.id);
    const report = await getExperimentReport(experiment.id);
    if (report) {
      return replyAndLog(ctx, formatExperimentReport(report), bundle.world.id, bundle.agent.id);
    }
    const latest = await getLatestEvaluations(bundle.world.id, 1);
    await replyAndLog(ctx, [
      formatActiveExperiment(experiment),
      "",
      latest[0] ? `Latest score: ${latest[0].summary}` : "No scores yet."
    ].join("\n"), bundle.world.id, bundle.agent.id);
  });

  bot.command("last_tick", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const tick = await getLatestCompletedTick(bundle.world.id);
    if (!tick) return replyAndLog(ctx, "No completed ticks yet.", bundle.world.id, bundle.agent.id);
    const action = await getActionForTick(tick.id);
    const evaluation = await getEvaluationForTick(tick.id);
    await replyAndLog(ctx, formatTickDebugMessage({ tick, action, evaluation }), bundle.world.id, bundle.agent.id);
  });

  bot.command("tick_log", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const tickNumber = Number(getArgs(ctx));
    if (!Number.isInteger(tickNumber) || tickNumber < 1) {
      return replyAndLog(ctx, "Usage: /tick_log <tick_number>", bundle.world.id, bundle.agent.id);
    }
    const tick = await getTickByNumber(bundle.world.id, tickNumber);
    if (!tick) return replyAndLog(ctx, `No tick #${tickNumber}.`, bundle.world.id, bundle.agent.id);
    const action = await getActionForTick(tick.id);
    const evaluation = await getEvaluationForTick(tick.id);
    await replyAndLog(ctx, formatTickDebugMessage({ tick, action, evaluation }), bundle.world.id, bundle.agent.id);
  });

  bot.command("last_action", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const action = await getLatestAction(bundle.world.id);
    await replyAndLog(ctx, formatActionDebugMessage(action), bundle.world.id, bundle.agent.id);
  });

  bot.command("why_score", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const evaluation = await getLatestEvaluation(bundle.world.id);
    await replyAndLog(ctx, formatWhyScoreMessage(evaluation), bundle.world.id, bundle.agent.id);
  });

  bot.command("eval_details", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const evaluation = await getLatestEvaluation(bundle.world.id);
    await replyAndLog(ctx, formatEvaluationDetailsMessage(evaluation), bundle.world.id, bundle.agent.id);
  });

  bot.command("replay_experiment", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const experiment = await getLatestExperimentForReplay(bundle.world.id);
    if (!experiment) return replyAndLog(ctx, "No experiment exists yet.", bundle.world.id, bundle.agent.id);
    const rows = await getExperimentReplay(experiment.id);
    const report = await getLatestExperimentReportForReplay(experiment.id);
    await replyAndLog(ctx, formatExperimentReplayMessage({
      title: experiment.title,
      status: experiment.status,
      progress: `${experiment.current_tick_count} / ${experiment.duration_ticks}`,
      rows,
      report
    }), bundle.world.id, bundle.agent.id);
  });

  bot.command("proposals", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const proposals = await sql`
      select id, category, title, risk_level, status, created_at
      from world_proposals
      where world_id = ${bundle.world.id}
      order by created_at desc
      limit 10
    `;
    const text = proposals.length === 0
      ? "No proposals yet."
      : proposals.map((proposal) => [
        `${String(proposal.id).slice(0, 8)} - ${String(proposal.title)}`,
        `Category: ${String(proposal.category)}, risk: ${String(proposal.risk_level)}, status: ${String(proposal.status)}`
      ].join("\n")).join("\n\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("approve_proposal", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const idPrefix = getArgs(ctx);
    if (!idPrefix) return replyAndLog(ctx, "Usage: /approve_proposal <id>", bundle.world.id, bundle.agent.id);

    const [proposal] = await sql`
      select * from world_proposals
      where world_id = ${bundle.world.id}
        and status = 'submitted'
        and id::text like ${`${idPrefix}%`}
      order by created_at asc
      limit 1
    `;
    if (!proposal) return replyAndLog(ctx, "No submitted proposal matched that id.", bundle.world.id, bundle.agent.id);

    const category = String(proposal.category);
    if (category === "constitution") {
      const [article] = await sql`
        select coalesce(max(article_number), 0) + 1 as next_article_number
        from world_constitution_articles
        where world_id = ${bundle.world.id}
      `;
      await sql`
        insert into world_constitution_articles (world_id, article_number, title, body)
        values (${bundle.world.id}, ${Number(article.next_article_number)}, ${String(proposal.title)}, ${String(proposal.body)})
      `;
    }

    if (category === "rule") {
      const rules = [...bundle.worldState.rules, String(proposal.body)];
      await sql`
        update world_state
        set state = ${JSON.stringify({ ...bundle.worldState, rules })},
            updated_at = now()
        where world_id = ${bundle.world.id}
      `;
    }

    await sql`
      update world_proposals
      set status = 'approved',
          game_master_decision = 'approved',
          decided_at = now()
      where id = ${String(proposal.id)}
    `;
    await replyAndLog(ctx, `Approved proposal ${String(proposal.id).slice(0, 8)}.`, bundle.world.id, bundle.agent.id);
  });

  bot.command("reject_proposal", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [idPrefix, ...reasonParts] = getArgs(ctx).split(/\s+/);
    const reason = reasonParts.join(" ");
    if (!idPrefix || !reason) {
      return replyAndLog(ctx, "Usage: /reject_proposal <id> <reason>", bundle.world.id, bundle.agent.id);
    }

    const [proposal] = await sql`
      select * from world_proposals
      where world_id = ${bundle.world.id}
        and status = 'submitted'
        and id::text like ${`${idPrefix}%`}
      order by created_at asc
      limit 1
    `;
    if (!proposal) return replyAndLog(ctx, "No submitted proposal matched that id.", bundle.world.id, bundle.agent.id);

    await sql`
      update world_proposals
      set status = 'rejected',
          game_master_decision = ${reason},
          decided_at = now()
      where id = ${String(proposal.id)}
    `;
    await replyAndLog(ctx, `Rejected proposal ${String(proposal.id).slice(0, 8)}.`, bundle.world.id, bundle.agent.id);
  });

  bot.command("inject_event", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const content = getArgs(ctx);
    if (!content) return replyAndLog(ctx, "Usage: /inject_event <text>", bundle.world.id, bundle.agent.id);
    await createWorldEventOnce({
      worldId: bundle.world.id,
      eventType: "game_master_event",
      title: null,
      content,
      severity: 1,
      source: "game_master"
    });
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${bundle.world.id}, 'telegram_admin', ${String(ctx.from?.id ?? "")}, 'inject_event', ${JSON.stringify({ content })})
    `;
    await replyAndLog(ctx, "Event added.", bundle.world.id, bundle.agent.id);
  });

  bot.command("give_resource", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [resource, amountRaw] = getArgs(ctx).split(/\s+/);
    const parsedResource = resourceKeySchema.safeParse(resource);
    const amount = Number(amountRaw);
    if (!parsedResource.success || !Number.isFinite(amount)) {
      return replyAndLog(ctx, "Usage: /give_resource <food|water|medicine|tools> <amount>", bundle.world.id, bundle.agent.id);
    }
    const nextState = applyResourceDelta(bundle.worldState, parsedResource.data, amount);
    await sql`update world_state set state = ${JSON.stringify(nextState)}, updated_at = now() where world_id = ${bundle.world.id}`;
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${bundle.world.id}, 'telegram_admin', ${String(ctx.from?.id ?? "")}, 'give_resource', ${JSON.stringify({ resource, amount })})
    `;
    await replyAndLog(ctx, `Resource updated: ${parsedResource.data} = ${nextState.resources[parsedResource.data]}`, bundle.world.id, bundle.agent.id);
  });

  bot.command(["damage", "heal"], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const [stat, amountRaw, ...reasonParts] = getArgs(ctx).split(/\s+/);
    const parsedStat = statKeySchema.safeParse(stat);
    const amount = Number(amountRaw);
    const reason = reasonParts.join(" ");
    if (!parsedStat.success || !Number.isFinite(amount) || !reason) {
      return replyAndLog(ctx, "Usage: /damage <stat> <amount> <reason> or /heal <stat> <amount> <reason>", bundle.world.id, bundle.agent.id);
    }

    const direction = ctx.message?.text?.startsWith("/heal") ? "heal" : "damage";
    const nextStats = applyGameMasterStatChange(bundle.stats, parsedStat.data, amount, direction);
    await sql`
      update agent_stats
      set health = ${nextStats.health},
          energy = ${nextStats.energy},
          stress = ${nextStats.stress},
          morale = ${nextStats.morale},
          reputation = ${nextStats.reputation},
          influence = ${nextStats.influence},
          ethics = ${nextStats.ethics},
          curiosity = ${nextStats.curiosity},
          fear = ${nextStats.fear},
          hunger = ${nextStats.hunger},
          thirst = ${nextStats.thirst},
          updated_at = now()
      where agent_id = ${bundle.agent.id}
    `;
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${bundle.world.id}, 'telegram_admin', ${String(ctx.from?.id ?? "")}, ${direction}, ${JSON.stringify({ stat, amount, reason })})
    `;
    await replyAndLog(ctx, `${parsedStat.data} is now ${nextStats[parsedStat.data]}.`, bundle.world.id, bundle.agent.id);
  });
}
