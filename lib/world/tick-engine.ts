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

type TickResult = {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  publicMessage?: string;
  tickId?: string;
};

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
    const worldBefore = { world, worldState, events };
    const agentBefore = { agent, stats, memories };

    const [tick] = await sql`
      insert into ticks (world_id, tick_number, phase, world_before, agent_before)
      values (${world.id}, ${world.tick_count + 1}, ${phase}, ${JSON.stringify(worldBefore)}, ${JSON.stringify(agentBefore)})
      returning id
    `;
    tickId = (tick as { id: string }).id;

    const aiOutput = await generateAgentTick({ world, agent, stats, worldState, events, memories, phase, perception });
    const actionResult = await applySelectedAction({ world, agent, stats, worldState, events, tickId, aiOutput });
    const nextStats = actionResult.stats;
    const nextWorldState = actionResult.worldState;
    const formattedPublicMessage = formatTickMessage({
      world,
      phase,
      publicMessage: aiOutput.public_message,
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

    const observationInput = aiOutput.new_observations.length > 0
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
