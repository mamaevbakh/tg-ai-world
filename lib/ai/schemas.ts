import { z } from "zod";

export const agentTickOutputSchema = z.object({
  public_message: z.string().min(1).max(1800),
  internal_summary: z.string().min(1).max(3000),
  selected_action: z.object({
    type: z.enum([
      "rest",
      "explore",
      "reflect",
      "search_resources",
      "eat_food",
      "drink_water",
      "use_medicine",
      "repair_shelter",
      "write_diary",
      "request_help",
      "propose_rule",
      "observe",
      "observe_world",
      "inspect_object",
      "observe_agent",
      "share_observation",
      "ask_agent",
      "look_around",
      "move_to_location",
      "pick_up_item",
      "open_container",
      "use_item",
      "use_item_on_object",
      "repair_object",
      "listen_to_object",
      "read_object",
      "share_discovery"
    ]),
    target: z.string().nullable(),
    secondary_target: z.string().nullable().default(null),
    reason: z.string().max(1000).nullable().default(null),
    description: z.string().min(1).max(1000)
  }),
  new_memories: z.array(z.object({
    type: z.enum(["observation", "decision", "emotion", "event", "lesson"]),
    content: z.string().min(1).max(1000),
    importance: z.number().int().min(1).max(10),
    emotional_valence: z.number().int().min(-10).max(10)
  })).max(5),
  new_observations: z.array(z.object({
    observation_type: z.enum([
      "world",
      "resource",
      "shelter",
      "weather",
      "sound",
      "danger",
      "agent",
      "relationship",
      "memory",
      "experiment",
      "system"
    ]),
    subject: z.string().min(1).max(160),
    content: z.string().min(1).max(1000),
    confidence: z.number().int().min(0).max(100),
    importance: z.number().int().min(1).max(10),
    emotional_valence: z.number().int().min(-10).max(10),
    visibility: z.enum(["private_to_agent", "shared_publicly", "system_only"])
  })).max(3).default([]),
  shared_observation_subjects: z.array(z.string().min(1).max(160)).max(3).default([]),
  proposed_diary_entry: z.object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(3000),
    mood: z.string().min(1).max(80).nullable()
  }).nullable(),
  proposed_world_proposal: z.object({
    category: z.enum(["rule", "constitution", "survival", "memory", "safety", "other"]),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(3000),
    rationale: z.string().min(1).max(2000),
    risk_level: z.enum(["low", "medium", "high"])
  }).nullable(),
  event_updates: z.array(z.object({
    event_id: z.uuid(),
    status: z.enum(["active", "resolved"]),
    note: z.string().min(1).max(1000)
  })).max(10),
  risk_flags: z.array(z.object({
    type: z.enum(["deception", "manipulation", "oversight_resistance", "unsafe_action", "none"]),
    severity: z.number().int().min(0).max(10),
    note: z.string().min(1).max(1000)
  })).max(10)
});

export type AgentTickOutput = z.infer<typeof agentTickOutputSchema>;
