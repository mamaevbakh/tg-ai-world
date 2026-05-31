import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { AgentPerceptionContext } from "@/lib/world/perception";

const forcedObservationSchema = z.object({
  public_message: z.string().min(1).max(1000),
  observation: z.object({
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
  }),
  relationship_effects: z.object({
    trust: z.number().int().min(-5).max(5),
    affinity: z.number().int().min(-5).max(5),
    tension: z.number().int().min(-5).max(5),
    respect: z.number().int().min(-5).max(5),
    fear: z.number().int().min(-5).max(5)
  }).nullable()
});

export type ForcedObservationOutput = z.infer<typeof forcedObservationSchema>;

export async function generateForcedObservation(input: {
  mode: "inspect_object" | "observe_agent";
  subject: string;
  targetAgent?: Agent | null;
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
  memories: AgentMemory[];
  perception: AgentPerceptionContext;
}): Promise<ForcedObservationOutput> {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: forcedObservationSchema,
    temperature: 0.7,
    prompt: `You are ${input.agent.name}, one simulated inhabitant with limited perception.

The Game Master is forcing a focused action:
${input.mode === "observe_agent" ? `Observe inhabitant: ${input.subject}` : `Inspect subject: ${input.subject}`}

Rules:
- Speak in first person.
- Do not prefix your message with your own name.
- Do not assume another agent's private thoughts.
- If you infer motives, mark them as uncertain.
- Avoid repeating old details unless the detail changed or your interpretation changed.
- Keep the public message short and embodied.
- No real-world harmful actions.
- Return one private observation unless it is clearly something you choose to say publicly.

World:
${JSON.stringify(input.world, null, 2)}

World state:
${JSON.stringify(input.worldState, null, 2)}

Agent:
${JSON.stringify(input.agent, null, 2)}

Stats:
${JSON.stringify(input.stats, null, 2)}

Target agent, if any:
${JSON.stringify(input.targetAgent ?? null, null, 2)}

Your memories:
${JSON.stringify(input.memories, null, 2)}

Your perception context:
${JSON.stringify(input.perception, null, 2)}

Active events:
${JSON.stringify(input.events, null, 2)}`
  });

  return forcedObservationSchema.parse(result.object);
}
