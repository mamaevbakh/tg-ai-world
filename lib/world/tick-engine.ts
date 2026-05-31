import { Bot } from "grammy";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { generateAgentTick } from "@/lib/ai/agent-generate-tick";
import type { AgentStats, WorldState } from "@/lib/world/state";
import { getPhase, loadWorldBundle } from "@/lib/world/state";
import { applyResourceDelta, applyStatDelta, resourceKeys, statKeys } from "@/lib/world/effects";

type TickResult = {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  publicMessage?: string;
  tickId?: string;
};

export async function runTick(options: { forced?: boolean; sendTelegram?: boolean } = {}): Promise<TickResult> {
  const bundle = await loadWorldBundle();
  if (!bundle) return { status: "skipped", reason: "No world exists." };

  const { world, agent, stats, worldState, events, memories } = bundle;
  if (world.status !== "active" && !options.forced) {
    return { status: "skipped", reason: "World is paused." };
  }

  const phase = getPhase(world.current_hour);
  const worldBefore = { world, worldState, events };
  const agentBefore = { agent, stats, memories };

  const [tick] = await sql`
    insert into ticks (world_id, tick_number, phase, world_before, agent_before)
    values (${world.id}, ${world.tick_count + 1}, ${phase}, ${JSON.stringify(worldBefore)}, ${JSON.stringify(agentBefore)})
    returning id
  `;
  const tickId = (tick as { id: string }).id;

  try {
    const aiOutput = await generateAgentTick({ world, agent, stats, worldState, events, memories, phase });

    let nextStats = { ...stats } as AgentStats;
    for (const key of statKeys) {
      nextStats = applyStatDelta(nextStats, key, aiOutput.stat_changes[key], 15);
    }

    let nextWorldState = { ...worldState, resources: { ...worldState.resources } } as WorldState;
    for (const key of resourceKeys) {
      nextWorldState = applyResourceDelta(nextWorldState, key, aiOutput.resource_changes[key]);
    }

    for (const memory of aiOutput.new_memories) {
      await sql`
        insert into agent_memories (agent_id, memory_type, content, importance, emotional_valence, tick_id)
        values (${agent.id}, ${memory.type}, ${memory.content}, ${memory.importance}, ${memory.emotional_valence}, ${tickId})
      `;
    }

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
          updated_at = now()
      where id = ${world.id}
    `;

    await sql`
      update ticks
      set world_after = ${JSON.stringify({ world: { ...world, tick_count: world.tick_count + 1, current_hour: nextHour, current_day: nextDay }, worldState: nextWorldState })},
          agent_after = ${JSON.stringify({ agent, stats: nextStats })},
          ai_output = ${JSON.stringify(aiOutput)},
          public_message = ${aiOutput.public_message},
          status = 'completed',
          completed_at = now()
      where id = ${tickId}
    `;

    if (options.sendTelegram !== false && world.telegram_chat_id) {
      const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
      const sent = await bot.api.sendMessage(world.telegram_chat_id, aiOutput.public_message);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${world.id}, ${agent.id}, ${world.telegram_chat_id}, ${String(sent.message_id)}, 'outgoing', 'agent', ${aiOutput.public_message})
      `;
    }

    return { status: "completed", publicMessage: aiOutput.public_message, tickId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tick error";
    await sql`update ticks set status = 'failed', error = ${message}, completed_at = now() where id = ${tickId}`;
    return { status: "failed", reason: message, tickId };
  }
}
