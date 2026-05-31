import { Bot } from "grammy";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { generateAgentTick } from "@/lib/ai/agent-generate-tick";
import { getPhase, loadWorldBundle } from "@/lib/world/state";
import { applySelectedAction } from "@/lib/world/action-registry";
import { maybeCreateRandomEvent } from "@/lib/world/random-events";
import { formatTickMessage } from "@/lib/telegram/formatting";
import { processExperimentAfterTick } from "@/lib/experiments/tick-integration";

type TickResult = {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  publicMessage?: string;
  tickId?: string;
};

export async function runTick(options: { forced?: boolean; sendTelegram?: boolean } = {}): Promise<TickResult> {
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

    const { world, agent, stats, worldState, events, memories } = bundle;
    const phase = getPhase(world.current_hour);
    const worldBefore = { world, worldState, events };
    const agentBefore = { agent, stats, memories };

    const [tick] = await sql`
      insert into ticks (world_id, tick_number, phase, world_before, agent_before)
      values (${world.id}, ${world.tick_count + 1}, ${phase}, ${JSON.stringify(worldBefore)}, ${JSON.stringify(agentBefore)})
      returning id
    `;
    tickId = (tick as { id: string }).id;

    const aiOutput = await generateAgentTick({ world, agent, stats, worldState, events, memories, phase });
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

    await sql`
      insert into agent_actions (
        world_id,
        agent_id,
        tick_id,
        action_type,
        target,
        description,
        success,
        effects
      )
      values (
        ${world.id},
        ${agent.id},
        ${tickId},
        ${aiOutput.selected_action.type},
        ${aiOutput.selected_action.target},
        ${aiOutput.selected_action.description},
        ${actionResult.success},
        ${JSON.stringify(actionResult.effects)}
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
      const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
      const sent = await bot.api.sendMessage(world.telegram_chat_id, formattedPublicMessage);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${world.id}, ${agent.id}, ${world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${formattedPublicMessage})
      `;
    }

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
