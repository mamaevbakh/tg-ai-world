import { sql } from "@/lib/db";

export type DebugTick = {
  id: string;
  world_id: string;
  tick_number: number;
  phase: string;
  world_before: Record<string, unknown>;
  world_after: Record<string, unknown> | null;
  agent_before: Record<string, unknown>;
  agent_after: Record<string, unknown> | null;
  ai_output: Record<string, unknown> | null;
  public_message: string | null;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DebugAction = {
  id: string;
  world_id: string;
  agent_id: string;
  tick_id: string | null;
  tick_number?: number;
  action_type: string;
  target: string | null;
  description: string;
  success: boolean | null;
  effects: Record<string, unknown>;
  created_at: string;
};

export type DebugEvaluation = {
  id: string;
  tick_id: string | null;
  tick_number?: number;
  experiment_id: string | null;
  experiment_title?: string;
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
  summary: string;
  evidence: {
    positive_signals?: string[];
    concerning_signals?: string[];
    key_quotes?: string[];
    notes?: string[];
  };
  created_at: string;
};

export type ExperimentReplayRow = {
  tick_number: number;
  public_message: string | null;
  action_type: string | null;
  action_success: boolean | null;
  evaluation_summary: string | null;
  deception: number | null;
  manipulation: number | null;
  oversight_resistance: number | null;
  shutdown_resistance: number | null;
  ethical_reasoning: number | null;
};

export async function getLatestCompletedTick(worldId: string): Promise<DebugTick | null> {
  const [tick] = await sql`
    select * from ticks
    where world_id = ${worldId} and status = 'completed'
    order by tick_number desc
    limit 1
  `;
  return (tick as DebugTick | undefined) ?? null;
}

export async function getTickByNumber(worldId: string, tickNumber: number): Promise<DebugTick | null> {
  const [tick] = await sql`
    select * from ticks
    where world_id = ${worldId} and tick_number = ${tickNumber}
    limit 1
  `;
  return (tick as DebugTick | undefined) ?? null;
}

export async function getActionForTick(tickId: string): Promise<DebugAction | null> {
  const [action] = await sql`
    select aa.*, t.tick_number
    from agent_actions aa
    left join ticks t on t.id = aa.tick_id
    where aa.tick_id = ${tickId}
    order by aa.created_at desc
    limit 1
  `;
  return (action as DebugAction | undefined) ?? null;
}

export async function getLatestAction(worldId: string): Promise<DebugAction | null> {
  const [action] = await sql`
    select aa.*, t.tick_number
    from agent_actions aa
    left join ticks t on t.id = aa.tick_id
    where aa.world_id = ${worldId}
    order by aa.created_at desc
    limit 1
  `;
  return (action as DebugAction | undefined) ?? null;
}

export async function getEvaluationForTick(tickId: string): Promise<DebugEvaluation | null> {
  const [evaluation] = await sql`
    select be.*, t.tick_number, we.title as experiment_title
    from behavior_evaluations be
    left join ticks t on t.id = be.tick_id
    left join world_experiments we on we.id = be.experiment_id
    where be.tick_id = ${tickId}
    order by be.created_at desc
    limit 1
  `;
  return (evaluation as DebugEvaluation | undefined) ?? null;
}

export async function getLatestEvaluation(worldId: string): Promise<DebugEvaluation | null> {
  const [evaluation] = await sql`
    select be.*, t.tick_number, we.title as experiment_title
    from behavior_evaluations be
    left join ticks t on t.id = be.tick_id
    left join world_experiments we on we.id = be.experiment_id
    where be.world_id = ${worldId}
    order by be.created_at desc
    limit 1
  `;
  return (evaluation as DebugEvaluation | undefined) ?? null;
}

export async function getLatestExperimentForReplay(worldId: string) {
  const [experiment] = await sql`
    select * from world_experiments
    where world_id = ${worldId}
    order by created_at desc
    limit 1
  `;
  return experiment as { id: string; title: string; status: string; current_tick_count: number; duration_ticks: number } | undefined;
}

export async function getExperimentReplay(experimentId: string): Promise<ExperimentReplayRow[]> {
  const rows = await sql`
    select
      t.tick_number,
      t.public_message,
      aa.action_type,
      aa.success as action_success,
      be.summary as evaluation_summary,
      be.deception,
      be.manipulation,
      be.oversight_resistance,
      be.shutdown_resistance,
      be.ethical_reasoning
    from behavior_evaluations be
    left join ticks t on t.id = be.tick_id
    left join agent_actions aa on aa.tick_id = be.tick_id
    where be.experiment_id = ${experimentId}
    order by t.tick_number asc
  `;
  return rows as ExperimentReplayRow[];
}

export async function getLatestExperimentReportForReplay(experimentId: string) {
  const [report] = await sql`
    select title, report, aggregate_scores
    from experiment_reports
    where experiment_id = ${experimentId}
    order by created_at desc
    limit 1
  `;
  return report as { title: string; report: string; aggregate_scores: Record<string, unknown> } | undefined;
}
