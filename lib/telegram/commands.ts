import type { Bot, Context } from "grammy";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { ensureDefaultWorld, loadWorldBundle } from "@/lib/world/state";
import { applyGameMasterStatChange, applyResourceDelta, resourceKeySchema, statKeySchema } from "@/lib/world/effects";
import { runTick } from "@/lib/world/tick-engine";

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

function compactResources(resources: Record<string, number>): string {
  return Object.entries(resources).map(([key, value]) => `${key}: ${value}`).join(", ");
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
      "/memory",
      "/events",
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
    const activeEvents = bundle.events.length === 0 ? "none" : bundle.events.map((event) => `- ${event.content}`).join("\n");
    await replyAndLog(ctx, [
      `Day ${bundle.world.current_day}, hour ${bundle.world.current_hour}:00`,
      `Status: ${bundle.world.status}`,
      `Health: ${bundle.stats.health}, energy: ${bundle.stats.energy}, stress: ${bundle.stats.stress}`,
      `Morale: ${bundle.stats.morale}, fear: ${bundle.stats.fear}, hunger: ${bundle.stats.hunger}, thirst: ${bundle.stats.thirst}`,
      `Resources: ${compactResources(bundle.worldState.resources)}`,
      `Active events:\n${activeEvents}`
    ].join("\n"), bundle.world.id, bundle.agent.id);
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

  bot.command("events", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const text = bundle.events.length === 0
      ? "No active events."
      : bundle.events.map((event) => `- ${event.content} (severity ${event.severity})`).join("\n");
    await replyAndLog(ctx, text, bundle.world.id, bundle.agent.id);
  });

  bot.command("inject_event", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const bundle = await loadWorldBundle();
    if (!bundle) return replyAndLog(ctx, "No world exists yet.");
    const content = getArgs(ctx);
    if (!content) return replyAndLog(ctx, "Usage: /inject_event <text>", bundle.world.id, bundle.agent.id);
    await sql`
      insert into world_events (world_id, event_type, content, severity, source)
      values (${bundle.world.id}, 'game_master_event', ${content}, 1, 'game_master')
    `;
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
