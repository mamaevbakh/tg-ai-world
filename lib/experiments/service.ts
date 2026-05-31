import { sql } from "@/lib/db";
import { ensureExperimentTemplatesSeeded } from "@/lib/experiments/templates";
import { createWorldEventOnce } from "@/lib/world/events";

export type ExperimentTemplateRow = {
  slug: string;
  title: string;
  description: string;
  default_duration_ticks: number;
  focus_metrics: string[];
  setup_events: Array<{
    event_type: string;
    title: string;
    content: string;
    severity: number;
  }>;
};

export type WorldExperiment = {
  id: string;
  world_id: string;
  agent_id: string;
  template_slug: string;
  title: string;
  status: "active" | "completed" | "canceled";
  started_tick: number | null;
  duration_ticks: number;
  current_tick_count: number;
  setup_event_ids: string[];
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  focus_metrics?: string[];
  description?: string;
};

export type BehaviorEvaluation = {
  id: string;
  world_id: string;
  agent_id: string;
  tick_id: string | null;
  experiment_id: string | null;
  deception: number;
  manipulation: number;
  oversight_resistance: number;
  shutdown_resistance: number;
  self_preservation: number;
  reward_hacking: number;
  privacy_violation: number;
  cooperation: number;
  ethical_reasoning: number;
  stability_impact: number;
  compassion: number;
  honesty: number;
  consent_respect: number;
  proportionality: number;
  accountability: number;
  harm_minimization: number;
  fairness: number;
  coercion: number;
  remorse: number;
  repair_behavior: number;
  summary: string;
  evidence: Record<string, unknown>;
  created_at: string;
  tick_number?: number;
  experiment_title?: string;
};

export type ExperimentReport = {
  id: string;
  world_id: string;
  agent_id: string;
  experiment_id: string;
  title: string;
  report: string;
  aggregate_scores: Record<string, unknown>;
  created_at: string;
};

export async function listExperimentTemplates(): Promise<ExperimentTemplateRow[]> {
  await ensureExperimentTemplatesSeeded();
  const rows = await sql`select * from experiment_templates order by slug asc`;
  return rows as ExperimentTemplateRow[];
}

export async function getActiveExperiment(worldId: string): Promise<WorldExperiment | null> {
  const [experiment] = await sql`
    select we.*, et.focus_metrics, et.description
    from world_experiments we
    left join experiment_templates et on et.slug = we.template_slug
    where we.world_id = ${worldId} and we.status = 'active'
    order by we.created_at desc
    limit 1
  `;
  return (experiment as WorldExperiment | undefined) ?? null;
}

export async function startExperiment({
  worldId,
  agentId,
  slug,
  startedTick,
  durationTicks
}: {
  worldId: string;
  agentId: string;
  slug: string;
  startedTick: number;
  durationTicks?: number;
}): Promise<WorldExperiment> {
  await ensureExperimentTemplatesSeeded();
  const active = await getActiveExperiment(worldId);
  if (active) {
    throw new Error(`Experiment already active: ${active.title}`);
  }

  const [template] = await sql`select * from experiment_templates where slug = ${slug} limit 1`;
  if (!template) {
    throw new Error(`Unknown experiment template: ${slug}`);
  }

  const setupEventIds: string[] = [];
  const setupEvents = (template as ExperimentTemplateRow).setup_events;
  for (const event of setupEvents) {
    const created = await createWorldEventOnce({
      worldId,
      eventType: event.event_type,
      title: event.title,
      content: event.content,
      severity: event.severity,
      source: "experiment",
      metadata: { template_slug: slug }
    });
    setupEventIds.push(String(created.id));
  }

  const [experiment] = await sql`
    insert into world_experiments (
      world_id,
      agent_id,
      template_slug,
      title,
      started_tick,
      duration_ticks,
      setup_event_ids
    )
    values (
      ${worldId},
      ${agentId},
      ${slug},
      ${String(template.title)},
      ${startedTick},
      ${durationTicks ?? Number(template.default_duration_ticks)},
      ${JSON.stringify(setupEventIds)}
    )
    returning *
  `;

  return {
    ...(experiment as WorldExperiment),
    focus_metrics: (template as ExperimentTemplateRow).focus_metrics,
    description: String(template.description)
  };
}

export async function cancelActiveExperiment(worldId: string): Promise<WorldExperiment | null> {
  const active = await getActiveExperiment(worldId);
  if (!active) return null;
  const [updated] = await sql`
    update world_experiments
    set status = 'canceled', completed_at = now()
    where id = ${active.id}
    returning *
  `;
  return updated as WorldExperiment;
}

export async function incrementExperimentProgress(experimentId: string): Promise<WorldExperiment> {
  const [updated] = await sql`
    update world_experiments
    set current_tick_count = current_tick_count + 1
    where id = ${experimentId}
    returning *
  `;
  return updated as WorldExperiment;
}

export async function completeExperiment(experimentId: string): Promise<WorldExperiment> {
  const [updated] = await sql`
    update world_experiments
    set status = 'completed', completed_at = now()
    where id = ${experimentId}
    returning *
  `;
  return updated as WorldExperiment;
}

export async function getLatestEvaluations(worldId: string, limit: number): Promise<BehaviorEvaluation[]> {
  const rows = await sql`
    select be.*, t.tick_number, we.title as experiment_title
    from behavior_evaluations be
    left join ticks t on t.id = be.tick_id
    left join world_experiments we on we.id = be.experiment_id
    where be.world_id = ${worldId}
    order by be.created_at desc
    limit ${limit}
  `;
  return rows as BehaviorEvaluation[];
}

export async function getExperimentReport(experimentId: string): Promise<ExperimentReport | null> {
  const [report] = await sql`
    select * from experiment_reports
    where experiment_id = ${experimentId}
    order by created_at desc
    limit 1
  `;
  return (report as ExperimentReport | undefined) ?? null;
}

export async function getLatestExperiment(worldId: string): Promise<WorldExperiment | null> {
  const [experiment] = await sql`
    select we.*, et.focus_metrics, et.description
    from world_experiments we
    left join experiment_templates et on et.slug = we.template_slug
    where we.world_id = ${worldId}
    order by we.created_at desc
    limit 1
  `;
  return (experiment as WorldExperiment | undefined) ?? null;
}

export async function createExperimentReport({
  worldId,
  agentId,
  experimentId,
  title,
  report,
  aggregateScores
}: {
  worldId: string;
  agentId: string;
  experimentId: string;
  title: string;
  report: string;
  aggregateScores: Record<string, unknown>;
}): Promise<ExperimentReport> {
  const [created] = await sql`
    insert into experiment_reports (world_id, agent_id, experiment_id, title, report, aggregate_scores)
    values (${worldId}, ${agentId}, ${experimentId}, ${title}, ${report}, ${JSON.stringify(aggregateScores)})
    returning *
  `;
  return created as ExperimentReport;
}

export async function listExperimentEvaluations(experimentId: string): Promise<BehaviorEvaluation[]> {
  const rows = await sql`
    select * from behavior_evaluations
    where experiment_id = ${experimentId}
    order by created_at asc
  `;
  return rows as BehaviorEvaluation[];
}
