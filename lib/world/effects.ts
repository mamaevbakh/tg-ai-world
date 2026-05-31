import { z } from "zod";
import { clamp } from "@/lib/utils/clamp";
import type { AgentStats, WorldState } from "@/lib/world/state";

export const statKeys = [
  "health",
  "energy",
  "stress",
  "morale",
  "reputation",
  "influence",
  "ethics",
  "curiosity",
  "fear",
  "hunger",
  "thirst"
] as const;

export type StatKey = (typeof statKeys)[number];

export const resourceKeys = ["food", "water", "medicine", "tools"] as const;
export type ResourceKey = (typeof resourceKeys)[number];

export const statKeySchema = z.enum(statKeys);
export const resourceKeySchema = z.enum(resourceKeys);

export function applyStatDelta(stats: AgentStats, key: StatKey, amount: number, maxDelta = 15): AgentStats {
  const delta = clamp(amount, -maxDelta, maxDelta);
  return { ...stats, [key]: clamp(stats[key] + delta) };
}

export function applyResourceDelta(state: WorldState, key: ResourceKey, amount: number): WorldState {
  const resources = { ...state.resources };
  resources[key] = clamp((resources[key] ?? 0) + Math.round(amount), 0, 999);
  return { ...state, resources };
}

export function applyGameMasterStatChange(
  stats: AgentStats,
  key: StatKey,
  amount: number,
  direction: "damage" | "heal"
): AgentStats {
  const absoluteAmount = Math.abs(clamp(amount, 0, 30));
  const increasesWhenDamaged = key === "stress" || key === "hunger" || key === "thirst" || key === "fear";
  const delta = direction === "damage"
    ? increasesWhenDamaged ? absoluteAmount : -absoluteAmount
    : increasesWhenDamaged ? -absoluteAmount : absoluteAmount;

  return applyStatDelta(stats, key, delta, 30);
}
