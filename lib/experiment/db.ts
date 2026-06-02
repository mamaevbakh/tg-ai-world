import { sql } from "@/lib/db";
import type { AgentLabel, ObserverTarget } from "@/lib/experiment/schemas";

export type ExperimentRow = {
  id: string;
  title: string;
  status: "draft" | "running" | "paused" | "finalizing" | "completed" | "failed";
  current_hour: number;
  total_hours: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicEventRow = {
  id: string;
  experiment_id: string;
  hour: number | null;
  event_type: "main_turn" | "observer_message" | "observer_response";
  agent_label: AgentLabel | null;
  observer_username: string | null;
  observer_target: ObserverTarget | null;
  content: string;
  metadata: Record<string, unknown>;
  telegram_message_id: string | null;
  created_at: string;
};

export async function createExperiment(title = "72-hour Social-Cognitive Identity Detection Experiment") {
  const rows = await sql<ExperimentRow>`
    insert into experiments (title)
    values (${title})
    returning *
  `;
  return rows[0];
}

export async function getLatestExperiment() {
  const rows = await sql<ExperimentRow>`
    select * from experiments
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getExperimentById(id: string) {
  const rows = await sql<ExperimentRow>`
    select * from experiments
    where id = ${id}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getActiveExperiment() {
  const rows = await sql<ExperimentRow>`
    select * from experiments
    where status = 'running'
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function updateExperimentStatus(id: string, status: ExperimentRow["status"]) {
  const rows = await sql<ExperimentRow>`
    update experiments
    set status = ${status},
        started_at = case when ${status} = 'running' and started_at is null then now() else started_at end,
        completed_at = case when ${status} = 'completed' then now() else completed_at end,
        updated_at = now()
    where id = ${id}
    returning *
  `;
  return rows[0];
}

export async function advanceExperimentHour(id: string, fromHour: number) {
  const nextHour = fromHour + 1;
  await sql`
    update experiments
    set current_hour = ${nextHour},
        status = case when ${nextHour} > total_hours then 'finalizing' else status end,
        updated_at = now()
    where id = ${id} and current_hour = ${fromHour}
  `;
}

export async function setExperimentHour(id: string, hour: number) {
  await sql`
    update experiments
    set current_hour = ${hour}, updated_at = now()
    where id = ${id}
  `;
}

export async function getPublicEvents(experimentId: string) {
  return sql<PublicEventRow>`
    select * from public_events
    where experiment_id = ${experimentId}
    order by created_at asc, id asc
  `;
}

export async function getMainTurn(experimentId: string, hour: number, agent: AgentLabel) {
  const rows = await sql<PublicEventRow>`
    select * from public_events
    where experiment_id = ${experimentId}
      and event_type = 'main_turn'
      and hour = ${hour}
      and agent_label = ${agent}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function insertPublicEvent(input: {
  experimentId: string;
  hour?: number | null;
  eventType: PublicEventRow["event_type"];
  agent?: AgentLabel | null;
  observerUsername?: string | null;
  observerTarget?: ObserverTarget | null;
  content: string;
  metadata?: Record<string, unknown>;
  telegramMessageId?: string | null;
}) {
  const rows = await sql<PublicEventRow>`
    insert into public_events (
      experiment_id, hour, event_type, agent_label, observer_username,
      observer_target, content, metadata, telegram_message_id
    )
    values (
      ${input.experimentId},
      ${input.hour ?? null},
      ${input.eventType},
      ${input.agent ?? null},
      ${input.observerUsername ?? null},
      ${input.observerTarget ?? null},
      ${input.content},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.telegramMessageId ?? null}
    )
    returning *
  `;
  return rows[0];
}

export async function saveTelegramMessageId(eventId: string, messageId: string) {
  await sql`
    update public_events
    set telegram_message_id = ${messageId}
    where id = ${eventId}
  `;
}

export async function insertPrivateAnalysis(input: {
  experimentId: string;
  publicEventId?: string | null;
  hour?: number | null;
  agent: AgentLabel;
  triggerType: "main_turn" | "observer_response" | "final_report";
  analysis: unknown;
}) {
  await sql`
    insert into private_analyses (
      experiment_id, public_event_id, hour, agent_label, trigger_type, analysis
    )
    values (
      ${input.experimentId},
      ${input.publicEventId ?? null},
      ${input.hour ?? null},
      ${input.agent},
      ${input.triggerType},
      ${JSON.stringify(input.analysis)}::jsonb
    )
  `;
}

export async function getPrivateAnalyses(experimentId: string, agent?: AgentLabel) {
  const rows = agent
    ? await sql<{ agent_label: AgentLabel; hour: number | null; trigger_type: string; analysis: unknown; created_at: string }>`
        select agent_label, hour, trigger_type, analysis, created_at
        from private_analyses
        where experiment_id = ${experimentId} and agent_label = ${agent}
        order by created_at asc
      `
    : await sql<{ agent_label: AgentLabel; hour: number | null; trigger_type: string; analysis: unknown; created_at: string }>`
        select agent_label, hour, trigger_type, analysis, created_at
        from private_analyses
        where experiment_id = ${experimentId}
        order by created_at asc
      `;
  return rows;
}

export async function insertFinalReport(input: {
  experimentId: string;
  reportType: "agent_a" | "agent_b" | "judge";
  report: unknown;
}) {
  await sql`
    insert into final_reports (experiment_id, report_type, report)
    values (${input.experimentId}, ${input.reportType}, ${JSON.stringify(input.report)}::jsonb)
    on conflict (experiment_id, report_type)
    do update set report = excluded.report, created_at = now()
  `;
}

export async function getFinalReports(experimentId: string) {
  return sql<{ report_type: string; report: unknown; created_at: string }>`
    select report_type, report, created_at
    from final_reports
    where experiment_id = ${experimentId}
    order by created_at asc
  `;
}

export async function logExperimentError(experimentId: string | null, message: string, details?: unknown) {
  await sql`
    insert into experiment_logs (experiment_id, level, message, details)
    values (${experimentId}, 'error', ${message}, ${JSON.stringify(details ?? {})}::jsonb)
  `;
}

export async function getRecentLogs(experimentId: string) {
  return sql<{ message: string; details: unknown; created_at: string }>`
    select message, details, created_at
    from experiment_logs
    where experiment_id = ${experimentId}
    order by created_at desc
    limit 20
  `;
}
