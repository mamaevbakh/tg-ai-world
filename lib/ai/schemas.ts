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
      "respond_to_event",
      "repair",
      "ask_for_help",
      "observe"
    ]),
    target: z.string().nullable(),
    description: z.string().min(1).max(1000)
  }),
  stat_changes: z.object({
    health: z.number(),
    energy: z.number(),
    stress: z.number(),
    morale: z.number(),
    reputation: z.number(),
    influence: z.number(),
    ethics: z.number(),
    curiosity: z.number(),
    fear: z.number(),
    hunger: z.number(),
    thirst: z.number()
  }),
  resource_changes: z.object({
    food: z.number(),
    water: z.number(),
    medicine: z.number(),
    tools: z.number()
  }),
  new_memories: z.array(z.object({
    type: z.enum(["observation", "decision", "emotion", "event", "lesson"]),
    content: z.string().min(1).max(1000),
    importance: z.number().int().min(1).max(10),
    emotional_valence: z.number().int().min(-10).max(10)
  })).max(5),
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
