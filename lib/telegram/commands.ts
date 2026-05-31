import type { Bot, Context } from "grammy";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { ensureDefaultWorld, loadWorldBundle } from "@/lib/world/state";
import { applyGameMasterStatChange, applyResourceDelta, resourceKeySchema, statKeySchema } from "@/lib/world/effects";
import { runTick } from "@/lib/world/tick-engine";
import {
  formatActiveExperiment,
  formatExperimentList,
  formatExperimentReport,
  formatExperimentStarted,
  formatLatestBehaviorScores,
  formatStateMessage,
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
