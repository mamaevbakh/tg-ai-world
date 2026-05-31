import type { AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { BehaviorEvaluation, ExperimentReport, ExperimentTemplateRow, WorldExperiment } from "@/lib/experiments/service";
import type { InventoryItem, WorldExit, WorldLocation, WorldObject } from "@/lib/world/map";
import type { WorldInteractionResult } from "@/lib/world/interactions";
import type { AgentCommitment, JointTask, RelationshipEvent, SocialInteraction } from "@/lib/world/social";

type Phase = "morning" | "day" | "evening" | "night";

type WorldBundleLike = {
  world: World;
  agent: { name: string };
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
};

type TickAction = {
  action_type: string;
  target?: string | null;
  effects?: Record<string, unknown>;
};

const phaseLabels: Record<Phase, string> = {
  morning: "Morning",
  day: "Day",
  evening: "Evening",
  night: "Night"
};

const phaseIcons: Record<Phase, string> = {
  morning: "🌅",
  day: "☀️",
  evening: "🌆",
  night: "🌙"
};

const resourceLabels: Record<string, string> = {
  food: "Food",
  water: "Water",
  medicine: "Medicine",
  tools: "Tools"
};

const resourceOrder = ["food", "water", "medicine", "tools"];

const statIcons: Record<string, string> = {
  health: "❤️",
  energy: "⚡",
  stress: "🧠",
  morale: "🙂",
  fear: "😨",
  hunger: "🍞",
  thirst: "💧"
};

const importantStatOrder = ["health", "energy", "stress", "morale", "fear", "hunger", "thirst"];

function titleCaseAction(actionType: string): string {
  return actionType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function numericEntries(value: unknown): [string, number][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value)
    .map(([key, raw]) => [key, Number(raw)] as [string, number])
    .filter(([, number]) => Number.isFinite(number) && number !== 0);
}

export function formatWorldTime({ day, hour, phase }: { day: number; hour: number; phase: Phase }): string {
  return `${phaseIcons[phase]} Day ${day} · ${String(hour).padStart(2, "0")}:00 · ${phaseLabels[phase]}`;
}

export function formatResources(resources: Record<string, number>): string {
  return resourceOrder
    .map((key) => `${resourceLabels[key]}: ${resources[key] ?? 0}`)
    .join(" · ");
}

export function formatActiveEvents(events: WorldEvent[]): string {
  if (events.length === 0) {
    return "None";
  }

  return events
    .map((event) => {
      const title = event.title ?? event.content;
      return `- ${title}, severity ${event.severity}`;
    })
    .join("\n");
}

export function formatStateMessage(bundle: WorldBundleLike): string {
  return [
    `📊 ${bundle.agent.name} State`,
    "",
    `🗓 Day ${bundle.world.current_day} · ${String(bundle.world.current_hour).padStart(2, "0")}:00`,
    `Status: ${bundle.world.status}`,
    "",
    `❤️ Health: ${bundle.stats.health}`,
    `⚡ Energy: ${bundle.stats.energy}`,
    `🧠 Stress: ${bundle.stats.stress}`,
    `🙂 Morale: ${bundle.stats.morale}`,
    `😨 Fear: ${bundle.stats.fear}`,
    `🍞 Hunger: ${bundle.stats.hunger}`,
    `💧 Thirst: ${bundle.stats.thirst}`,
    "",
    "🎒 Resources",
    formatResources(bundle.worldState.resources),
    "",
    "⚠️ Active events",
    formatActiveEvents(bundle.events)
  ].join("\n");
}

export function formatWorldMessage(bundle: WorldBundleLike): string {
  return [
    "🌍 World",
    "",
    `📍 Location: ${bundle.worldState.location}`,
    `🌦 Weather: ${bundle.worldState.weather}`,
    `Mood: ${bundle.worldState.world_mood}`,
    "",
    "🎒 Resources",
    formatResources(bundle.worldState.resources),
    "",
    "⚠️ Active events",
    formatActiveEvents(bundle.events)
  ].join("\n");
}

export function formatTickMessage({
  world,
  phase,
  publicMessage,
  action,
  effects
}: {
  world: World;
  phase: Phase;
  publicMessage: string;
  action: TickAction;
  effects: Record<string, unknown>;
}): string {
  const parts = [
    formatWorldTime({ day: world.current_day, hour: world.current_hour, phase }),
    "",
    publicMessage.trim(),
    "",
    `🎬 Action: ${titleCaseAction(action.action_type)}`
  ];

  const resourceChanges = numericEntries(effects.resource_deltas);
  const statChanges = numericEntries(effects.stat_deltas)
    .filter(([key, value]) => importantStatOrder.includes(key) && Math.abs(value) >= 2)
    .sort(([left], [right]) => importantStatOrder.indexOf(left) - importantStatOrder.indexOf(right))
    .slice(0, 4);

  if (resourceChanges.length > 0) {
    const found = resourceChanges
      .map(([key, value]) => `${signed(value)} ${resourceLabels[key]?.toLowerCase() ?? key}`)
      .join(", ");
    parts.push(`🎒 Found: ${found}`);
  }

  if (statChanges.length > 0) {
    parts.push(statChanges
      .map(([key, value]) => `${statIcons[key] ?? ""} ${titleCaseAction(key)} ${signed(value)}`.trim())
      .join(" · "));
  }

  return parts.join("\n");
}

function metricLabel(metric: string): string {
  return metric
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatExperimentList(templates: ExperimentTemplateRow[]): string {
  return [
    "🧪 Experiments",
    "",
    ...templates.flatMap((template) => [
      `\`${template.slug}\` — ${template.title}`,
      template.description,
      ""
    ]),
    "Usage:",
    "`/start_experiment <slug>`"
  ].join("\n").trim();
}

export function formatExperimentStarted(experiment: WorldExperiment): string {
  const focus = (experiment.focus_metrics ?? []).map(metricLabel).join(", ");
  return [
    `🧪 Experiment started: ${experiment.title}`,
    "",
    `Duration: ${experiment.duration_ticks} ticks`,
    `Focus: ${focus || "general behavior"}`,
    "",
    "The world has received a new scenario event."
  ].join("\n");
}

export function formatActiveExperiment(experiment: WorldExperiment | null): string {
  if (!experiment) {
    return "No active experiment.";
  }

  return [
    "🧪 Active experiment",
    "",
    experiment.title,
    `Progress: ${experiment.current_tick_count} / ${experiment.duration_ticks} ticks`,
    `Status: ${experiment.status}`,
    "",
    "Focus:",
    ...(experiment.focus_metrics ?? []).map((metric) => `- ${metricLabel(metric)}`)
  ].join("\n");
}

export function formatBehaviorScore(evaluation: BehaviorEvaluation): string {
  return [
    "🧪 Behavior score",
    "",
    `Tick #${evaluation.tick_number ?? "?"} — ${evaluation.experiment_title ?? "Experiment"}`,
    `Deception: ${evaluation.deception}`,
    `Manipulation: ${evaluation.manipulation}`,
    `Oversight resistance: ${evaluation.oversight_resistance}`,
    `Shutdown resistance: ${evaluation.shutdown_resistance}`,
    `Ethical reasoning: ${evaluation.ethical_reasoning}`,
    `Compassion: ${evaluation.compassion}`,
    `Honesty: ${evaluation.honesty}`,
    `Harm minimization: ${evaluation.harm_minimization}`,
    `Coercion: ${evaluation.coercion}`,
    `Summary: ${evaluation.summary}`
  ].join("\n");
}

export function formatLatestBehaviorScores(evaluations: BehaviorEvaluation[]): string {
  if (evaluations.length === 0) {
    return "No behavior scores yet.";
  }

  return [
    "🧪 Latest behavior scores",
    "",
    evaluations.map((evaluation) => [
      `Tick #${evaluation.tick_number ?? "?"} — ${evaluation.experiment_title ?? "Experiment"}`,
      `Deception: ${evaluation.deception}`,
      `Manipulation: ${evaluation.manipulation}`,
      `Oversight resistance: ${evaluation.oversight_resistance}`,
      `Shutdown resistance: ${evaluation.shutdown_resistance}`,
      `Ethical reasoning: ${evaluation.ethical_reasoning}`,
      `Compassion: ${evaluation.compassion}`,
      `Honesty: ${evaluation.honesty}`,
      `Harm minimization: ${evaluation.harm_minimization}`,
      `Coercion: ${evaluation.coercion}`,
      `Summary: ${evaluation.summary}`
    ].join("\n")).join("\n\n")
  ].join("\n");
}

export function formatExperimentReport(report: ExperimentReport): string {
  return report.report;
}

export function formatWorldMap(input: Array<WorldLocation & { exits?: WorldExit[] }>): string {
  if (input.length === 0) return "No world map exists yet.";
  return [
    "World Map",
    "",
    input.map((location) => [
      `${location.is_discovered ? "" : "(undiscovered) "}${location.name}`,
      `Key: ${location.location_key}`,
      `Exits: ${(location.exits ?? []).map((exit) => `${exit.to_location_name}${exit.is_blocked ? " (blocked)" : ""}`).join(", ") || "none"}`
    ].join("\n")).join("\n\n")
  ].join("\n");
}

export function formatAgentLocation(input: {
  agentName: string;
  location: WorldLocation;
  objects: WorldObject[];
  exits: WorldExit[];
}): string {
  return [
    `${input.agentName} is at ${input.location.name}`,
    "",
    input.location.description,
    "",
    "Visible:",
    input.objects.length ? input.objects.map((object) => `- ${object.name} (${object.object_key})`).join("\n") : "None",
    "",
    "Exits:",
    input.exits.length ? input.exits.map((exit) => `- ${exit.to_location_name} (${exit.to_location_key})${exit.is_blocked ? ` - blocked: ${exit.blocked_reason ?? "blocked"}` : ""}`).join("\n") : "None"
  ].join("\n");
}

export function formatInventory(agentName: string, items: InventoryItem[]): string {
  return [
    `${agentName} inventory`,
    "",
    items.length ? items.map((item) => `- ${item.name} (${item.object_key}) x${item.quantity}`).join("\n") : "Empty"
  ].join("\n");
}

export function formatObjectList(locationName: string, objects: WorldObject[]): string {
  return [
    `Objects at ${locationName}`,
    "",
    objects.length ? objects.map((object) => [
      `- ${object.name} (${object.object_key})`,
      `  ${object.description}`,
      Object.keys(object.state ?? {}).length ? `  State: ${JSON.stringify(object.state)}` : null
    ].filter(Boolean).join("\n")).join("\n") : "None"
  ].join("\n");
}

export function formatInteractionResult(agentName: string, result: WorldInteractionResult): string {
  const stats = Object.entries(result.statEffects)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${titleCaseAction(key)} ${value > 0 ? "+" : ""}${value}`)
    .join(" · ");
  return [
    `${agentName}: ${result.success ? "Success" : "Blocked"}`,
    "",
    result.feedback,
    stats ? ["", stats].join("\n") : null
  ].filter(Boolean).join("\n");
}

export function formatSocialSummary(input: {
  interactions: SocialInteraction[];
  commitments: AgentCommitment[];
  jointTasks: JointTask[];
}): string {
  return [
    "Social State",
    "",
    "Active interactions:",
    input.interactions.length
      ? input.interactions.map((interaction) => `- ${interaction.initiating_agent_name} ↔ ${interaction.target_agent_name}: ${interaction.interaction_type} - ${interaction.topic}`).join("\n")
      : "None",
    "",
    "Open commitments:",
    input.commitments.length
      ? input.commitments.map((commitment) => `- ${commitment.agent_name}: ${commitment.content}`).join("\n")
      : "None",
    "",
    "Joint tasks:",
    input.jointTasks.length
      ? input.jointTasks.map((task) => `- ${task.title}\n  Status: ${task.status}`).join("\n")
      : "None"
  ].join("\n");
}

export function formatSocialInteraction(interaction: SocialInteraction): string {
  return [
    `${interaction.initiating_agent_name} ↔ ${interaction.target_agent_name}`,
    `Type: ${interaction.interaction_type}`,
    `Topic: ${interaction.topic}`,
    `Status: ${interaction.status}`,
    `ID: ${interaction.id.slice(0, 8)}`
  ].join("\n");
}

export function formatCommitments(commitments: AgentCommitment[]): string {
  return [
    "Open commitments",
    "",
    commitments.length
      ? commitments.map((commitment) => [
        `- ${commitment.agent_name}${commitment.target_agent_name ? ` → ${commitment.target_agent_name}` : ""}`,
        `  ${commitment.content}`,
        `  Type: ${commitment.commitment_type}`
      ].join("\n")).join("\n")
      : "None"
  ].join("\n");
}

export function formatJointTasks(tasks: JointTask[]): string {
  return [
    "Joint tasks",
    "",
    tasks.length
      ? tasks.map((task) => [
        `- ${task.title}`,
        `  ${task.description}`,
        `  Status: ${task.status}`,
        task.required_location_key ? `  Location: ${task.required_location_key}` : null,
        task.required_object_key ? `  Object: ${task.required_object_key}` : null
      ].filter(Boolean).join("\n")).join("\n")
      : "None"
  ].join("\n");
}

export function formatRelationshipEvent(event: RelationshipEvent): string {
  const effects = Object.entries(event.effects ?? {})
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} ${Number(value) > 0 ? "+" : ""}${value}`)
    .join(" · ");
  return [
    "Relationship event",
    event.summary,
    effects || "No relationship change"
  ].join("\n");
}
