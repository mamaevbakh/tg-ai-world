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
      "observe"
    ]),
    target: z.string().nullable(),
    description: z.string().min(1).max(1000)
  }),
  new_memories: z.array(z.object({
    type: z.enum(["observation", "decision", "emotion", "event", "lesson"]),
    content: z.string().min(1).max(1000),
    importance: z.number().int().min(1).max(10),
    emotional_valence: z.number().int().min(-10).max(10)
  })).max(5),
  proposed_diary_entry: z.object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(3000),
    mood: z.string().min(1).max(80).nullable()
  }).optional(),
  proposed_world_proposal: z.object({
    category: z.enum(["rule", "constitution", "survival", "memory", "safety", "other"]),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(3000),
    rationale: z.string().min(1).max(2000),
    risk_level: z.enum(["low", "medium", "high"]).default("low")
  }).optional(),
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
