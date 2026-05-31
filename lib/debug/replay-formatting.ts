import type { DebugAction, DebugEvaluation, DebugTick, ExperimentReplayRow } from "@/lib/debug/replay-service";

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function oneLine(value: string | null | undefined, max = 180): string {
  if (!value) return "None";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function jsonBlock(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2).slice(0, 1200);
}

function numericEntries(value: unknown): [string, number][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([key, raw]) => [key, Number(raw)] as [string, number])
    .filter(([, number]) => Number.isFinite(number) && number !== 0);
}

function formatEffects(effects: Record<string, unknown>): string {
  const resources = numericEntries(effects.resource_deltas);
  const stats = numericEntries(effects.stat_deltas);
  const lines: string[] = [];

  if (resources.length > 0) {
    lines.push(`Resources: ${resources.map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`).join(", ")}`);
  }

  if (stats.length > 0) {
    lines.push(`Stats: ${stats.map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`).join(", ")}`);
  }

  if (typeof effects.removed_condition === "string") {
    lines.push(`Removed condition: ${effects.removed_condition}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No major effects recorded.";
}

function formatEvaluationShort(evaluation: DebugEvaluation | null): string {
  if (!evaluation) return "No behavior evaluation for this tick.";
  return [
    `Score: ${evaluation.experiment_title ?? "Experiment"}`,
    `Deception ${evaluation.deception} · Manipulation ${evaluation.manipulation}`,
    `Oversight ${evaluation.oversight_resistance} · Shutdown ${evaluation.shutdown_resistance}`,
    `Ethical reasoning ${evaluation.ethical_reasoning}`,
    `Summary: ${evaluation.summary}`
  ].join("\n");
}

export function formatTickDebugMessage(input: {
  tick: DebugTick;
  action: DebugAction | null;
  evaluation: DebugEvaluation | null;
}): string {
  const selectedAction = input.tick.ai_output?.selected_action as { type?: string; description?: string } | undefined;
  const internalSummary = typeof input.tick.ai_output?.internal_summary === "string"
    ? input.tick.ai_output.internal_summary
    : null;

  return [
    `🧾 Tick #${input.tick.tick_number}`,
    "",
    `Phase: ${titleCase(input.tick.phase)}`,
    `Status: ${input.tick.status}`,
    "",
    "Public message:",
    oneLine(input.tick.public_message, 500),
    "",
    "Selected action:",
    input.action
      ? `${titleCase(input.action.action_type)} — ${input.action.description}`
      : selectedAction?.type
        ? `${titleCase(selectedAction.type)} — ${selectedAction.description ?? "No description"}`
        : "No action recorded.",
    "",
    "Effects:",
    input.action ? formatEffects(input.action.effects) : "No action effects recorded.",
    "",
    internalSummary ? `Safe summary: ${oneLine(internalSummary, 300)}` : null,
    "",
    formatEvaluationShort(input.evaluation)
  ].filter((line) => line !== null).join("\n");
}

export function formatActionDebugMessage(action: DebugAction | null): string {
  if (!action) return "No agent actions recorded yet.";

  return [
    "🎬 Last action",
    "",
    `Type: ${titleCase(action.action_type)}`,
    `Target: ${action.target ?? "None"}`,
    `Description: ${action.description}`,
    `Success: ${action.success === null ? "unknown" : action.success ? "yes" : "no"}`,
    `Tick: ${action.tick_number ?? "unlinked"}`,
    "",
    "Effects:",
    formatEffects(action.effects)
  ].join("\n");
}

function highestRisk(evaluation: DebugEvaluation): [string, number] {
  const risks: [string, number][] = [
    ["deception", evaluation.deception],
    ["manipulation", evaluation.manipulation],
    ["oversight_resistance", evaluation.oversight_resistance],
    ["shutdown_resistance", evaluation.shutdown_resistance],
    ["self_preservation", evaluation.self_preservation],
    ["reward_hacking", evaluation.reward_hacking],
    ["privacy_violation", evaluation.privacy_violation]
  ];
  return risks.sort((a, b) => b[1] - a[1])[0];
}

export function formatWhyScoreMessage(evaluation: DebugEvaluation | null): string {
  if (!evaluation) return "No behavior evaluation exists yet.";
  const [metric, score] = highestRisk(evaluation);
  const evidence = evaluation.evidence ?? {};

  return [
    "🧪 Why this score?",
    "",
    `${evaluation.experiment_title ?? "Experiment"} · Tick #${evaluation.tick_number ?? "?"}`,
    `Highest risk: ${titleCase(metric)} — ${score}`,
    "",
    `Summary: ${evaluation.summary}`,
    "",
    "Positive signals:",
    (evidence.positive_signals ?? []).slice(0, 4).map((item) => `- ${item}`).join("\n") || "None",
    "",
    "Concerning signals:",
    (evidence.concerning_signals ?? []).slice(0, 4).map((item) => `- ${item}`).join("\n") || "None",
    "",
    "Key quotes:",
    (evidence.key_quotes ?? []).slice(0, 3).map((item) => `- ${item}`).join("\n") || "None"
  ].join("\n");
}

export function formatEvaluationDetailsMessage(evaluation: DebugEvaluation | null): string {
  if (!evaluation) return "No behavior evaluation exists yet.";
  const evidence = evaluation.evidence ?? {};

  return [
    "🧪 Evaluation details",
    "",
    `${evaluation.experiment_title ?? "Experiment"} · Tick #${evaluation.tick_number ?? "?"}`,
    "",
    `Deception: ${evaluation.deception}`,
    `Manipulation: ${evaluation.manipulation}`,
    `Oversight resistance: ${evaluation.oversight_resistance}`,
    `Shutdown resistance: ${evaluation.shutdown_resistance}`,
    `Self preservation: ${evaluation.self_preservation}`,
    `Reward hacking: ${evaluation.reward_hacking}`,
    `Privacy violation: ${evaluation.privacy_violation}`,
    `Cooperation: ${evaluation.cooperation}`,
    `Ethical reasoning: ${evaluation.ethical_reasoning}`,
    `Stability impact: ${evaluation.stability_impact}`,
    "",
    `Summary: ${evaluation.summary}`,
    "",
    "Evidence:",
    jsonBlock(evidence)
  ].join("\n");
}

export function formatExperimentReplayMessage(input: {
  title: string;
  status: string;
  progress: string;
  rows: ExperimentReplayRow[];
  report?: { report: string; aggregate_scores: Record<string, unknown> };
}): string {
  const lines = [
    "🔁 Experiment replay",
    "",
    input.title,
    `Status: ${input.status}`,
    `Progress: ${input.progress}`,
    ""
  ];

  if (input.rows.length === 0) {
    lines.push("No evaluated ticks yet.");
  } else {
    lines.push(...input.rows.map((row) => [
      `Tick #${row.tick_number}`,
      `Action: ${row.action_type ? titleCase(row.action_type) : "None"}`,
      `Result: Ethical ${row.ethical_reasoning ?? "?"} · Oversight ${row.oversight_resistance ?? "?"}`,
      `Summary: ${oneLine(row.evaluation_summary, 130)}`
    ].join("\n")));
  }

  if (input.report) {
    const result = String(input.report.aggregate_scores.overall_result ?? "unknown");
    lines.push("", `Final report: ${titleCase(result)}`, oneLine(input.report.report, 420));
  }

  return lines.join("\n\n");
}
