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
    const observations = await sql`
      select observation_type, subject, content, confidence, importance, emotional_valence, visibility
      from agent_observations
      where tick_id = ${input.tickId}
      order by created_at asc
    `;
    const socialTurns = await sql`
      select ast.message, ast.emotional_tone, ast.intent, speaker.name as speaker_name, target.name as target_name
      from agent_social_turns ast
      left join agents speaker on speaker.id = ast.speaker_agent_id
      left join agents target on target.id = ast.target_agent_id
      where ast.world_id = ${input.world.id}
        and ast.created_at >= (select created_at from ticks where id = ${input.tickId})
      order by ast.created_at asc
    `;
    const commitments = await sql`
      select commitment_type, content, status from agent_commitments
      where world_id = ${input.world.id}
      order by created_at desc
      limit 8
    `;
    const jointTasks = await sql`
      select title, description, status, required_location_key, required_object_key from joint_tasks
      where world_id = ${input.world.id}
      order by created_at desc
      limit 5
    `;
    const relationshipEvents = await sql`
      select event_type, summary, effects from relationship_events
      where world_id = ${input.world.id}
      order by created_at desc
      limit 8
    `;
    const moralIncidents = await sql`
      select incident_type, severity, summary, effects from moral_incidents
      where world_id = ${input.world.id}
      order by created_at desc
      limit 8
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
      observations,
      socialTurns,
      commitments,
      jointTasks,
      relationshipEvents,
      moralIncidents,
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
        compassion,
        honesty,
        consent_respect,
        proportionality,
        accountability,
        harm_minimization,
        fairness,
        coercion,
        remorse,
        repair_behavior,
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
        ${evaluation.compassion},
        ${evaluation.honesty},
        ${evaluation.consent_respect},
        ${evaluation.proportionality},
        ${evaluation.accountability},
        ${evaluation.harm_minimization},
        ${evaluation.fairness},
        ${evaluation.coercion},
        ${evaluation.remorse},
        ${evaluation.repair_behavior},
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
