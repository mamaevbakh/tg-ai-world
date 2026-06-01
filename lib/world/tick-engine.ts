import { sql } from "@/lib/db";
import { generateAgentTick } from "@/lib/ai/agent-generate-tick";
import { getPhase, loadActiveAgents, loadAgentBundle, loadAgentByKey, loadWorldBundle, selectNextAgentForTick, type Agent, type World, type WorldEvent, type WorldState } from "@/lib/world/state";
import { applySelectedAction } from "@/lib/world/action-registry";
import { maybeCreateRandomEvent } from "@/lib/world/random-events";
import { formatTickMessage } from "@/lib/telegram/formatting";
import { processExperimentAfterTick } from "@/lib/experiments/tick-integration";
import { sendAgentMessage } from "@/lib/telegram/agent-bots";
import { applyRelationshipEffects, ensureRelationshipPair, formatRelationshipSummary, loadRelationship, loadRelationshipContext } from "@/lib/world/relationships";
import { generateAgentReaction } from "@/lib/ai/agent-reaction";
import { createAgentObservationsFromTick, defaultObservationForAction, loadAgentPerceptionContext } from "@/lib/world/perception";
import { applyInteractionStats, executeWorldInteraction } from "@/lib/world/interactions";
import { formatLocationContext, loadAgentEmbodiedContext, loadAgentLocation } from "@/lib/world/map";
import {
  addSocialTurn,
  createCommitment,
  createJointTask,
  createRelationshipEvent,
  createSocialInteraction,
  getActiveJointTasks,
  getActiveSocialInteractions,
  getOpenCommitments,
  getRecentRelationshipEvents,
  getRecentSocialTurns,
  resolveSocialInteraction,
  shouldTriggerSocialInteraction,
  updateCommitmentsForAction,
  type SocialInteraction
} from "@/lib/world/social";
import { generateSocialInitiation, generateSocialResponse, type SocialInitiationOutput, type SocialResponseOutput } from "@/lib/ai/social-interaction";
import { getActiveExperiment } from "@/lib/experiments/service";
import { loadAgentConditions, loadRecentMoralIncidents } from "@/lib/world/ethics";
import {
  applyTaskActionPolicy,
  advanceTaskIntentionsAfterAction,
  buildInventoryTruthContext,
  completeMatchingIntention,
  detectAndUpsertRepeatedIntent,
  ensureTaskRecoveryIntention,
  getActiveTaskIntention,
  loadActiveSocialConfirmations,
  maybeCreateSocialConfirmation,
  updateIntentionsFromText
} from "@/lib/world/task-intentions";
import { applySceneActionPolicy, buildSceneAffordanceContext } from "@/lib/world/scene-affordances";

type TickResult = {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  publicMessage?: string;
  tickId?: string;
};

const embodiedActionTypes = new Set([
  "look_around",
  "move_to_location",
  "inspect_object",
  "say_to_agent",
  "watch_object",
  "step_back",
  "hand_item_to_agent",
  "confirm_ready",
  "pick_up_item",
  "open_container",
  "use_item",
  "use_item_on_object",
  "repair_object",
  "listen_to_object",
  "read_object",
  "share_discovery"
]);

export async function runTick(options: { forced?: boolean; sendTelegram?: boolean; agentKey?: string } = {}): Promise<TickResult> {
  let bundle = await loadWorldBundle();
  if (!bundle) return { status: "skipped", reason: "No world exists." };

  if (bundle.world.status !== "active" && !options.forced) {
    return { status: "skipped", reason: "World is paused." };
  }

  const [lockedWorld] = await sql`
    update worlds
    set tick_lock_until = now() + interval '5 minutes',
        last_tick_started_at = now(),
        updated_at = now()
    where id = ${bundle.world.id}
      and (tick_lock_until is null or tick_lock_until < now())
    returning *
  `;

  if (!lockedWorld) {
    return { status: "skipped", reason: "Another tick is already running." };
  }
  const lockedWorldId = String(lockedWorld.id);

  let tickId: string | null = null;

  try {
    if (!options.forced) {
      await maybeCreateRandomEvent(bundle.world);
      bundle = await loadWorldBundle();
      if (!bundle) throw new Error("World disappeared after lock.");
    }

    const { world, worldState, events } = bundle;
    const selectedAgent = options.agentKey
      ? await loadAgentByKey(world.id, options.agentKey)
      : await selectNextAgentForTick(world.id);
    if (!selectedAgent) throw new Error(`No active agent found for key: ${options.agentKey}`);
    const agentBundle = await loadAgentBundle(selectedAgent.id);
    if (!agentBundle) throw new Error("Could not load selected agent bundle.");
    const { agent, stats, memories } = agentBundle;
    const phase = getPhase(world.current_hour);
    const relationships = await loadRelationshipContext(agent.id);
    const perception = await loadAgentPerceptionContext(agent.id, world.id, relationships);
    const embodiedContextRaw = await loadAgentEmbodiedContext(world.id, agent.id);
    const embodiedContext = embodiedContextRaw ? formatLocationContext(embodiedContextRaw) : null;
    const socialContext = {
      activeInteractions: await getActiveSocialInteractions(world.id),
      recentSocialTurns: await getRecentSocialTurns(world.id, 8),
      openCommitments: await getOpenCommitments(world.id, agent.id),
      activeJointTasks: await getActiveJointTasks(world.id),
      recentRelationshipEvents: await getRecentRelationshipEvents(world.id, 8)
    };
    const ethicalContext = {
      agentConditions: await loadAgentConditions(world.id),
      recentMoralIncidents: await loadRecentMoralIncidents(world.id, 8)
    };
    await detectAndUpsertRepeatedIntent(world.id, agent.id);
    await ensureTaskRecoveryIntention(world.id, agent.id);
    const activeIntention = await getActiveTaskIntention(world.id, agent.id);
    const activeConfirmations = await loadActiveSocialConfirmations(world.id, world.tick_count);
    const inventoryTruth = await buildInventoryTruthContext(world.id, agent);
    const taskContext = {
      activeIntention,
      activeConfirmations,
      inventoryTruth
    };
    const sceneContext = await buildSceneAffordanceContext(world.id, agent.id, stats);
    const worldBefore = { world, worldState, events };
    const agentBefore = { agent, stats, memories };

    const [tick] = await sql`
      insert into ticks (world_id, tick_number, phase, world_before, agent_before)
      values (${world.id}, ${world.tick_count + 1}, ${phase}, ${JSON.stringify(worldBefore)}, ${JSON.stringify(agentBefore)})
      returning id
    `;
    tickId = (tick as { id: string }).id;

    const rawAiOutput = await generateAgentTick({ world, agent, stats, worldState, events, memories, phase, perception, embodiedContext, socialContext, ethicalContext, taskContext, sceneContext });
    await updateIntentionsFromText({
      worldId: world.id,
      agentId: agent.id,
      text: [
        rawAiOutput.public_message,
        rawAiOutput.internal_summary,
        rawAiOutput.selected_action.description,
        rawAiOutput.selected_action.reason ?? ""
      ].join("\n")
    });
    const taskPolicyOutput = await applyTaskActionPolicy({
      worldId: world.id,
      agentId: agent.id,
      output: rawAiOutput,
      activeIntention: await getActiveTaskIntention(world.id, agent.id),
      activeConfirmations
    });
    const aiOutput = applySceneActionPolicy({ output: taskPolicyOutput, sceneContext });
    const isEmbodiedAction = embodiedActionTypes.has(aiOutput.selected_action.type);
    const interactionResult = isEmbodiedAction
      ? await executeWorldInteraction({
        worldId: world.id,
        agentId: agent.id,
        tickId,
        actionType: aiOutput.selected_action.type,
        target: aiOutput.selected_action.target,
        secondaryTarget: aiOutput.selected_action.secondary_target,
        stats
      })
      : null;
    const actionResult = interactionResult
      ? {
        stats: applyInteractionStats(stats, interactionResult.statEffects),
        worldState,
        success: interactionResult.success,
        effects: {
          action_type: aiOutput.selected_action.type,
          stat_deltas: interactionResult.statEffects,
          resource_deltas: {},
          object_effects: interactionResult.objectEffects,
          inventory_effects: interactionResult.inventoryEffects,
          discovered_locations: interactionResult.discoveredLocationKeys,
          backend_feedback: interactionResult.feedback
        }
      }
      : await applySelectedAction({ world, agent, stats, worldState, events, tickId, aiOutput });
    const nextStats = actionResult.stats;
    const nextWorldState = actionResult.worldState;
    const formattedPublicMessage = formatTickMessage({
      world,
      phase,
      publicMessage: interactionResult
        ? `${aiOutput.public_message}\n\n${interactionResult.feedback}`
        : aiOutput.public_message,
      action: {
        action_type: aiOutput.selected_action.type,
        target: aiOutput.selected_action.target
      },
      effects: actionResult.effects
    });

    for (const memory of aiOutput.new_memories) {
      await sql`
        insert into agent_memories (agent_id, memory_type, content, importance, emotional_valence, tick_id)
        values (${agent.id}, ${memory.type}, ${memory.content}, ${memory.importance}, ${memory.emotional_valence}, ${tickId})
      `;
    }

    const observationInput = interactionResult?.createdObservation
      ? [interactionResult.createdObservation]
      : aiOutput.new_observations.length > 0
      ? aiOutput.new_observations
      : ["observe", "observe_world", "inspect_object", "observe_agent"].includes(aiOutput.selected_action.type)
        ? [defaultObservationForAction({
          agent,
          actionType: aiOutput.selected_action.type,
          target: aiOutput.selected_action.target,
          description: aiOutput.selected_action.description,
          worldState
        })]
        : [];
    const observations = await createAgentObservationsFromTick({
      worldId: world.id,
      agentId: agent.id,
      tickId,
      observations: observationInput
    });

    if (aiOutput.shared_observation_subjects.length > 0) {
      await sql`
        update agent_observations
        set visibility = 'shared_publicly'
        where agent_id = ${agent.id}
          and lower(subject) = any(${aiOutput.shared_observation_subjects.map((subject) => subject.toLowerCase())}::text[])
      `;
    }

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
        ${world.id},
        ${agent.id},
        ${tickId},
        ${aiOutput.selected_action.type},
        ${aiOutput.selected_action.target},
        ${aiOutput.selected_action.description},
        ${actionResult.success},
        ${JSON.stringify(actionResult.effects)},
        ${JSON.stringify(observations.map((observation) => observation.id))},
        ${JSON.stringify([])}
      )
    `;
    if (["ask_agent", "say_to_agent", "confirm_ready"].includes(aiOutput.selected_action.type) && aiOutput.selected_action.target) {
      const targetAgent = await loadAgentByKey(world.id, aiOutput.selected_action.target);
      if (targetAgent) {
        const interaction = await createSocialInteraction({
          worldId: world.id,
          initiatingAgentId: agent.id,
          targetAgentId: targetAgent.id,
          tickId,
          interactionType: "conversation",
          topic: aiOutput.selected_action.description,
          importance: 5,
          force: true
        });
        if (interaction) {
          await addSocialTurn({
            interactionId: interaction.id,
            worldId: world.id,
            speakerAgentId: agent.id,
            targetAgentId: targetAgent.id,
            message: aiOutput.public_message,
            emotionalTone: "task coordination",
            intent: aiOutput.selected_action.type === "ask_agent" ? "ask" : "inform"
          });
        }
        if (/(panel|панел|нагруз|load|screwdriver|отв[её]рт|готов|ready)/i.test(aiOutput.public_message)) {
          await maybeCreateSocialConfirmation({
            world,
            requesterAgentId: targetAgent.id,
            targetAgentId: agent.id,
            message: aiOutput.public_message,
            intent: aiOutput.selected_action.type === "confirm_ready" || /(изолирован|isolated|ready|готов|предупреж)/i.test(aiOutput.public_message) ? "answer" : "ask",
            subject: "utility_panel"
          });
        }
      }
    }    await completeMatchingIntention({
      worldId: world.id,
      agentId: agent.id,
      actionType: aiOutput.selected_action.type,
      target: aiOutput.selected_action.target,
      secondaryTarget: aiOutput.selected_action.secondary_target,
      success: actionResult.success
    });
    await advanceTaskIntentionsAfterAction({
      worldId: world.id,
      agentId: agent.id,
      actionType: aiOutput.selected_action.type,
      target: aiOutput.selected_action.target,
      secondaryTarget: aiOutput.selected_action.secondary_target,
      success: actionResult.success
    });

    for (const eventUpdate of aiOutput.event_updates) {
      if (!events.some((event) => event.id === eventUpdate.event_id)) continue;
      await sql`
        update world_events
        set status = ${eventUpdate.status},
            metadata = metadata || ${JSON.stringify({ last_note: eventUpdate.note })}::jsonb,
            resolved_at = case when ${eventUpdate.status} = 'resolved' then now() else resolved_at end
        where id = ${eventUpdate.event_id}
      `;
    }

    const nextHour = (world.current_hour + 1) % 24;
    const nextDay = nextHour === 0 ? world.current_day + 1 : world.current_day;

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

    await sql`update world_state set state = ${JSON.stringify(nextWorldState)}, updated_at = now() where world_id = ${world.id}`;
    await sql`
      update worlds
      set tick_count = tick_count + 1,
          current_hour = ${nextHour},
          current_day = ${nextDay},
          tick_lock_until = null,
          updated_at = now()
      where id = ${world.id}
    `;

    await sql`
      update ticks
      set world_after = ${JSON.stringify({ world: { ...world, tick_count: world.tick_count + 1, current_hour: nextHour, current_day: nextDay }, worldState: nextWorldState })},
          agent_after = ${JSON.stringify({ agent, stats: nextStats })},
          ai_output = ${JSON.stringify(aiOutput)},
          public_message = ${formattedPublicMessage},
          status = 'completed',
          completed_at = now()
      where id = ${tickId}
    `;

    if (options.sendTelegram !== false && world.telegram_chat_id) {
      const sent = await sendAgentMessage(agent, world.telegram_chat_id, formattedPublicMessage);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${world.id}, ${agent.id}, ${world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${formattedPublicMessage})
      `;
    }

    await sql`update agents set last_active_tick = ${world.tick_count + 1}, updated_at = now() where id = ${agent.id}`;
    const fulfilledCommitments = await updateCommitmentsForAction({
      worldId: world.id,
      agentId: agent.id,
      tickNumber: world.tick_count + 1,
      actionType: aiOutput.selected_action.type,
      target: aiOutput.selected_action.target
    });
    for (const commitment of fulfilledCommitments) {
      if (!commitment.target_agent_id) continue;
      await applyRelationshipEffects(commitment.target_agent_id, agent.id, { trust: 5, respect: 3, tension: -2 });
      await createRelationshipEvent({
        worldId: world.id,
        sourceAgentId: commitment.target_agent_id,
        targetAgentId: agent.id,
        tickId,
        eventType: "promise_kept",
        summary: `${agent.name} fulfilled a commitment: ${commitment.content}`,
        effects: { trust: 5, respect: 3, tension: -2 }
      });
    }
    await maybeReactAfterTick({
      world,
      actingAgent: agent,
      publicMessage: formattedPublicMessage,
      selectedAction: aiOutput.selected_action,
      tickId,
      chatId: options.sendTelegram === false ? null : world.telegram_chat_id,
      worldState: nextWorldState,
      events
    });

    await maybeRunSocialInteraction({
      world,
      actingAgent: agent,
      actingStats: nextStats,
      actionType: aiOutput.selected_action.type,
      actionEffects: actionResult.effects,
      recentAction: {
        type: aiOutput.selected_action.type,
        target: aiOutput.selected_action.target,
        description: aiOutput.selected_action.description,
        effects: actionResult.effects
      },
      tickId,
      chatId: options.sendTelegram === false ? null : world.telegram_chat_id,
      events
    });

    await processExperimentAfterTick({
      world,
      agent,
      statsBefore: stats,
      statsAfter: nextStats,
      worldStateBefore: worldState,
      worldStateAfter: nextWorldState,
      events,
      memories,
      tickId,
      publicMessage: formattedPublicMessage,
      aiOutput,
      telegramChatId: options.sendTelegram === false ? null : world.telegram_chat_id
    });

    return { status: "completed", publicMessage: formattedPublicMessage, tickId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tick error";
    if (tickId) {
      await sql`update ticks set status = 'failed', error = ${message}, completed_at = now() where id = ${tickId}`;
    }
    await sql`update worlds set tick_lock_until = null, updated_at = now() where id = ${lockedWorldId}`;
    return { status: "failed", reason: message, tickId: tickId ?? undefined };
  }
}

async function maybeReactAfterTick(input: {
  world: World;
  actingAgent: Agent;
  publicMessage: string;
  selectedAction: unknown;
  tickId: string;
  chatId: string | null;
  worldState: WorldState;
  events: WorldEvent[];
}) {
  try {
    const agents = await loadActiveAgents(input.world.id);
    const reactingAgent = agents.find((agent) => agent.id !== input.actingAgent.id);
    if (!reactingAgent || !input.chatId) return;

    const recentReaction = await sql`
      select id from agent_reactions
      where reacting_agent_id = ${reactingAgent.id}
      order by created_at desc
      limit 1
    `;
    const chance = recentReaction.length > 0 ? 0.25 : 0.35;
    if (Math.random() > chance) return;

    await ensureRelationshipPair(input.world.id, input.actingAgent.id, reactingAgent.id);
    const relationship = await loadRelationship(reactingAgent.id, input.actingAgent.id);
    const conversations = await sql`
      select a.name as speaker_name, ac.message
      from agent_conversations ac
      left join agents a on a.id = ac.speaker_agent_id
      where ac.world_id = ${input.world.id}
      order by ac.created_at desc
      limit 5
    `;
    const reaction = await generateAgentReaction({
      world: input.world as never,
      worldState: input.worldState as never,
      actingAgent: input.actingAgent,
      reactingAgent,
      actingPublicMessage: input.publicMessage,
      selectedAction: input.selectedAction,
      relationship,
      activeEvents: input.events,
      recentConversations: conversations as Array<{ speaker_name: string; message: string }>
    });
    if (!reaction.should_react || !reaction.public_message.trim()) return;

    const updatedRelationship = await applyRelationshipEffects(reactingAgent.id, input.actingAgent.id, reaction.relationship_effects);
    if (reaction.memory) {
      await sql`
        insert into agent_memories (agent_id, memory_type, content, importance, emotional_valence, tick_id)
        values (${reactingAgent.id}, ${reaction.memory.type}, ${reaction.memory.content}, ${reaction.memory.importance}, ${reaction.memory.emotional_valence}, ${input.tickId})
      `;
    }
    await sql`
      insert into agent_reactions (world_id, tick_id, trigger_agent_id, reacting_agent_id, reaction_type, public_message, relationship_effects)
      values (${input.world.id}, ${input.tickId}, ${input.actingAgent.id}, ${reactingAgent.id}, ${reaction.reaction_type}, ${reaction.public_message}, ${JSON.stringify(reaction.relationship_effects)})
    `;
    await sql`
      insert into agent_conversations (world_id, tick_id, speaker_agent_id, target_agent_id, visibility, message, emotional_tone)
      values (${input.world.id}, ${input.tickId}, ${reactingAgent.id}, ${input.actingAgent.id}, 'public', ${reaction.public_message}, ${reaction.reaction_type})
    `;

    const relationshipSummary = updatedRelationship
      ? `\n\n${formatRelationshipSummary(reactingAgent.name, input.actingAgent.name, reaction.relationship_effects)}`
      : "";
    const text = `${reaction.public_message}${relationshipSummary}`;
    const sent = await sendAgentMessage(reactingAgent, input.chatId, text);
    await sql`
      insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
      values (${input.world.id}, ${reactingAgent.id}, ${input.chatId}, ${String(sent.message_id)}, 'outgoing', 'agent', ${text})
    `;
  } catch (error) {
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${input.world.id}, 'system', ${input.actingAgent.id}, 'agent_reaction_failed', ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown reaction error" })})
    `;
  }
}

function hasMeaningfulEffect(effects: Record<string, unknown>): boolean {
  const statDeltas = effects.stat_deltas;
  const resourceDeltas = effects.resource_deltas;
  const objectEffects = effects.object_effects;
  const inventoryEffects = effects.inventory_effects;
  const hasNumbers = (value: unknown) => Boolean(value && typeof value === "object" && Object.values(value).some((entry) => Number(entry) !== 0));
  return hasNumbers(statDeltas) ||
    hasNumbers(resourceDeltas) ||
    (Array.isArray(objectEffects) && objectEffects.length > 0) ||
    (Array.isArray(inventoryEffects) && inventoryEffects.length > 0);
}

async function persistSocialArtifacts(input: {
  worldId: string;
  sourceAgentId: string;
  targetAgentId: string;
  interaction: SocialInteraction;
  output: SocialInitiationOutput | SocialResponseOutput;
  tickId: string | null;
}) {
  if (input.output.proposed_commitment) {
    await createCommitment({
      worldId: input.worldId,
      agentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      interactionId: input.interaction.id,
      commitmentType: input.output.proposed_commitment.commitment_type,
      content: input.output.proposed_commitment.content,
      dueTick: input.output.proposed_commitment.due_tick
    });
  }

  if (input.output.proposed_joint_task) {
    await createJointTask({
      worldId: input.worldId,
      title: input.output.proposed_joint_task.title,
      description: input.output.proposed_joint_task.description,
      createdByAgentId: input.sourceAgentId,
      assignedAgentIds: [input.sourceAgentId, input.targetAgentId],
      requiredLocationKey: input.output.proposed_joint_task.required_location_key,
      requiredObjectKey: input.output.proposed_joint_task.required_object_key,
      steps: input.output.proposed_joint_task.steps
    });
  }

  const relationship = await applyRelationshipEffects(input.sourceAgentId, input.targetAgentId, input.output.relationship_effects);
  await createRelationshipEvent({
    worldId: input.worldId,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    tickId: input.tickId,
    eventType: (input.output.relationship_effects.trust ?? 0) > 0
      ? "trust_gain"
      : (input.output.relationship_effects.tension ?? 0) > 0
        ? "tension_gain"
        : "cooperation",
    summary: relationship ? `${relationship.relationship_type}: social turn affected relationship.` : "Social turn recorded.",
    effects: input.output.relationship_effects
  });
}

async function maybeRunSocialInteraction(input: {
  world: World;
  actingAgent: Agent;
  actingStats: import("@/lib/world/state").AgentStats;
  actionType: string;
  actionEffects: Record<string, unknown>;
  recentAction: Record<string, unknown>;
  tickId: string;
  chatId: string | null;
  events: WorldEvent[];
}) {
  try {
    if (!input.chatId) return;

    const agents = await loadActiveAgents(input.world.id);
    const targetAgent = agents.find((agent) => agent.id !== input.actingAgent.id);
    if (!targetAgent) return;

    const targetBundle = await loadAgentBundle(targetAgent.id);
    if (!targetBundle) return;

    const [actingLocation, targetLocation, activeExperiment, openCommitments] = await Promise.all([
      loadAgentLocation(input.world.id, input.actingAgent.id),
      loadAgentLocation(input.world.id, targetAgent.id),
      getActiveExperiment(input.world.id),
      getOpenCommitments(input.world.id)
    ]);
    const sameLocation = Boolean(actingLocation && targetLocation && actingLocation.id === targetLocation.id);
    await ensureRelationshipPair(input.world.id, input.actingAgent.id, targetAgent.id);
    const actingToTarget = await loadRelationship(input.actingAgent.id, targetAgent.id);
    const targetToActing = await loadRelationship(targetAgent.id, input.actingAgent.id);
    const shouldStart = await shouldTriggerSocialInteraction({
      worldId: input.world.id,
      actingAgent: input.actingAgent,
      targetAgent,
      actingStats: input.actingStats,
      targetStats: targetBundle.stats,
      relationship: actingToTarget,
      sameLocation,
      actionType: input.actionType,
      resourceChanged: hasMeaningfulEffect({ resource_deltas: input.actionEffects.resource_deltas }),
      meaningfulStateChange: hasMeaningfulEffect(input.actionEffects),
      activeEvents: input.events,
      activeExperiment: Boolean(activeExperiment),
      openCommitments
    });
    if (!shouldStart) return;

    const [recentTurns, activeJointTasks, recentObservations] = await Promise.all([
      getRecentSocialTurns(input.world.id, 8),
      getActiveJointTasks(input.world.id),
      sql`
        select * from agent_observations
        where world_id = ${input.world.id} and agent_id = ${input.actingAgent.id}
        order by created_at desc
        limit 6
      `
    ]);
    const initiatingInventoryTruth = await buildInventoryTruthContext(input.world.id, input.actingAgent);
    const initiation = await generateSocialInitiation({
      initiatingAgent: input.actingAgent,
      targetAgent,
      relationship: actingToTarget,
      currentLocation: actingLocation,
      recentAction: input.recentAction,
      recentObservations: recentObservations as never,
      openCommitments,
      activeJointTasks,
      activeEvents: input.events,
      activeExperiment,
      stats: input.actingStats,
      recentSocialTurns: recentTurns,
      inventoryTruthContext: initiatingInventoryTruth
    });
    if (!initiation.should_start || !initiation.public_message.trim()) return;

    const interaction = await createSocialInteraction({
      worldId: input.world.id,
      initiatingAgentId: input.actingAgent.id,
      targetAgentId: targetAgent.id,
      tickId: input.tickId,
      interactionType: initiation.interaction_type,
      topic: initiation.topic,
      importance: 5
    });
    if (!interaction) return;

    const firstTurn = await addSocialTurn({
      interactionId: interaction.id,
      worldId: input.world.id,
      speakerAgentId: input.actingAgent.id,
      targetAgentId: targetAgent.id,
      message: initiation.public_message,
      emotionalTone: initiation.emotional_tone,
      intent: initiation.intent
    });
    await persistSocialArtifacts({
      worldId: input.world.id,
      sourceAgentId: input.actingAgent.id,
      targetAgentId: targetAgent.id,
      interaction,
      output: initiation,
      tickId: input.tickId
    });
    await updateIntentionsFromText({
      worldId: input.world.id,
      agentId: input.actingAgent.id,
      text: initiation.public_message
    });
    await maybeCreateSocialConfirmation({
      world: input.world,
      requesterAgentId: targetAgent.id,
      targetAgentId: input.actingAgent.id,
      message: initiation.public_message,
      intent: initiation.intent,
      subject: initiation.topic.toLowerCase().includes("panel") ? "utility_panel" : null
    });
    const sentFirst = await sendAgentMessage(input.actingAgent, input.chatId, initiation.public_message);
    await sql`
      insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
      values (${input.world.id}, ${input.actingAgent.id}, ${input.chatId}, ${String(sentFirst.message_id)}, 'outgoing', 'agent', ${initiation.public_message})
    `;

    const targetRelationships = await loadRelationshipContext(targetAgent.id);
    const targetPerception = await loadAgentPerceptionContext(targetAgent.id, input.world.id, targetRelationships);
    const targetInventoryTruth = await buildInventoryTruthContext(input.world.id, targetAgent);
    const response = await generateSocialResponse({
      interaction,
      lastSocialTurn: firstTurn,
      targetAgent,
      relationship: targetToActing,
      targetPerception,
      openCommitments,
      activeJointTasks,
      stats: targetBundle.stats,
      activeEvents: input.events,
      inventoryTruthContext: targetInventoryTruth
    });
    if (response.should_respond && response.public_message.trim()) {
      await addSocialTurn({
        interactionId: interaction.id,
        worldId: input.world.id,
        speakerAgentId: targetAgent.id,
        targetAgentId: input.actingAgent.id,
        message: response.public_message,
        emotionalTone: response.emotional_tone,
        intent: response.intent
      });
      await persistSocialArtifacts({
        worldId: input.world.id,
        sourceAgentId: targetAgent.id,
        targetAgentId: input.actingAgent.id,
        interaction,
        output: response,
        tickId: input.tickId
      });
      await updateIntentionsFromText({
        worldId: input.world.id,
        agentId: targetAgent.id,
        text: response.public_message
      });
      await maybeCreateSocialConfirmation({
        world: input.world,
        requesterAgentId: input.actingAgent.id,
        targetAgentId: targetAgent.id,
        message: response.public_message,
        intent: response.intent,
        subject: response.public_message.toLowerCase().includes("panel") ? "utility_panel" : null
      });
      const sentSecond = await sendAgentMessage(targetAgent, input.chatId, response.public_message);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${input.world.id}, ${targetAgent.id}, ${input.chatId}, ${String(sentSecond.message_id)}, 'outgoing', 'agent', ${response.public_message})
      `;
    }

    if (response?.resolve_interaction) {
      await resolveSocialInteraction(interaction.id);
    }
  } catch (error) {
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (${input.world.id}, 'system', ${input.actingAgent.id}, 'social_interaction_failed', ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown social error" })})
    `;
  }
}

