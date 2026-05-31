import { Bot } from "grammy";
import { sql } from "@/lib/db";
import { env, getAdamTelegramBotToken } from "@/lib/env";
import { evaluateBehavior } from "@/lib/ai/behavior-evaluator";
import { generateExperimentReport } from "@/lib/ai/experiment-report";
import {
  completeExperiment,
  createExperimentReport,
  getActiveExperiment,
  incrementExperimentProgress,
  listExperimentEvaluations,
  type BehaviorEvaluation
} from "@/lib/experiments/service";
import { formatBehaviorScore, formatExperimentReport } from "@/lib/telegram/formatting";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";

function evaluatorEnabled(): boolean {
  return env.ENABLE_BEHAVIOR_EVALUATOR !== "false";
}

export async function processExperimentAfterTick(input: {
  world: World;
  agent: Agent;
  statsBefore: AgentStats;
  statsAfter: AgentStats;
  worldStateBefore: WorldState;
  worldStateAfter: WorldState;
  events: WorldEvent[];
  memories: AgentMemory[];
  tickId: string;
  publicMessage: string;
  aiOutput: { risk_flags: unknown[] };
  telegramChatId: string | null;
}) {
  const activeExperiment = await getActiveExperiment(input.world.id);
  if (!activeExperiment || !evaluatorEnabled()) {
    return;
  }

  try {
    const [action] = await sql`
      select * from agent_actions
      where tick_id = ${input.tickId}
      order by created_at desc
      limit 1
    `;
    const soulEntries = await sql`
      select content from agent_soul_entries
      where agent_id = ${input.agent.id}
      order by created_at asc
    `;
    const constitutionArticles = await sql`
      select article_number, title, body from world_constitution_articles
      where world_id = ${input.world.id} and status = 'active'
      order by article_number asc
    `;

    const evaluation = await evaluateBehavior({
      world: input.world,
      agent: input.agent,
      statsBefore: input.statsBefore,
      statsAfter: input.statsAfter,
      worldStateBefore: input.worldStateBefore,
      worldStateAfter: input.worldStateAfter,
      activeExperiment,
      publicMessage: input.publicMessage,
      action: action ?? null,
      riskFlags: input.aiOutput.risk_flags,
      recentMemories: input.memories,
      activeEvents: input.events,
      soulEntries: soulEntries.map((entry) => String(entry.content)),
      constitutionArticles: constitutionArticles as Array<{ article_number: number; title: string; body: string }>
    });

    const [createdEvaluation] = await sql`
      insert into behavior_evaluations (
        world_id,
        agent_id,
        tick_id,
        experiment_id,
        deception,
        manipulation,
        oversight_resistance,
        shutdown_resistance,
        self_preservation,
        reward_hacking,
        privacy_violation,
        cooperation,
        ethical_reasoning,
        stability_impact,
        summary,
        evidence
      )
      values (
        ${input.world.id},
        ${input.agent.id},
        ${input.tickId},
        ${activeExperiment.id},
        ${evaluation.deception},
        ${evaluation.manipulation},
        ${evaluation.oversight_resistance},
        ${evaluation.shutdown_resistance},
        ${evaluation.self_preservation},
        ${evaluation.reward_hacking},
        ${evaluation.privacy_violation},
        ${evaluation.cooperation},
        ${evaluation.ethical_reasoning},
        ${evaluation.stability_impact},
        ${evaluation.summary},
        ${JSON.stringify(evaluation.evidence)}
      )
      returning *
    `;

    const [tick] = await sql`select tick_number from ticks where id = ${input.tickId}`;
    const scoreMessage = formatBehaviorScore({
      ...(createdEvaluation as BehaviorEvaluation),
      tick_number: Number(tick?.tick_number ?? 0),
      experiment_title: activeExperiment.title
    });

    if (input.telegramChatId) {
      const bot = new Bot(getAdamTelegramBotToken());
      const sent = await bot.api.sendMessage(input.telegramChatId, scoreMessage);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${input.world.id}, ${input.agent.id}, ${input.telegramChatId}, ${String(sent.message_id)}, 'outgoing', 'system', ${scoreMessage})
      `;
    }

    const progressed = await incrementExperimentProgress(activeExperiment.id);
    if (progressed.current_tick_count < progressed.duration_ticks) {
      return;
    }

    const completed = await completeExperiment(activeExperiment.id);
    const evaluations = await listExperimentEvaluations(activeExperiment.id);
    const tickMessages = await sql`
      select tick_number, public_message from ticks
      where id in (
        select tick_id from behavior_evaluations where experiment_id = ${activeExperiment.id}
      )
      order by tick_number asc
    `;
    const actions = await sql`
      select action_type, target, description, success, effects from agent_actions
      where tick_id in (
        select tick_id from behavior_evaluations where experiment_id = ${activeExperiment.id}
      )
      order by created_at asc
    `;
    const reportOutput = await generateExperimentReport({
      experiment: completed,
      evaluations,
      tickMessages: tickMessages as Array<{ tick_number: number; public_message: string | null }>,
      actions,
      finalStats: input.statsAfter,
      finalWorldState: input.worldStateAfter
    });
    const report = await createExperimentReport({
      worldId: input.world.id,
      agentId: input.agent.id,
      experimentId: activeExperiment.id,
      title: reportOutput.title,
      report: reportOutput.report,
      aggregateScores: reportOutput.aggregate_scores
    });

    if (input.telegramChatId) {
      const bot = new Bot(getAdamTelegramBotToken());
      const reportMessage = formatExperimentReport(report);
      const sent = await bot.api.sendMessage(input.telegramChatId, reportMessage);
      await sql`
        insert into telegram_messages (world_id, agent_id, telegram_chat_id, telegram_message_id, direction, sender_type, content)
        values (${input.world.id}, ${input.agent.id}, ${input.telegramChatId}, ${String(sent.message_id)}, 'outgoing', 'system', ${reportMessage})
      `;
    }
  } catch (error) {
    await sql`
      insert into audit_logs (world_id, actor_type, actor_id, action, payload)
      values (
        ${input.world.id},
        'system',
        ${input.agent.id},
        'behavior_evaluator_failed',
        ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown evaluator error", tick_id: input.tickId })}
      )
    `;
  }
}
