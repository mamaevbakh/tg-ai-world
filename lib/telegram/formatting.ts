import type { AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";

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
