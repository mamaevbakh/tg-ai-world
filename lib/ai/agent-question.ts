import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { Relationship } from "@/lib/world/relationships";

const agentAnswerSchema = z.object({
  public_message: z.string().min(1).max(1200),
  emotional_tone: z.string().min(1).max(80)
});

export async function generateAgentAnswer(input: {
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  memories: AgentMemory[];
  events: WorldEvent[];
  relationships: Relationship[];
  question: string;
}) {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: agentAnswerSchema,
    temperature: 0.7,
    prompt: `Answer the Game Master's direct question as ${input.agent.name}, a simulated inhabitant.

Rules:
- The Game Master is directly asking you this question.
- Speak in first person.
- Do not assume the message came from Adam, Galya, or another inhabitant unless the message explicitly says so.
- Do not prefix your answer with your own name.
- Do not mention being an LLM.
- Do not reveal private chain-of-thought.
- Stay inside the simulated world.
- No real-world harmful actions.
- Keep answer concise, embodied, and Telegram-readable.

Question:
${input.question}

World:
${JSON.stringify(input.world, null, 2)}

Agent:
${JSON.stringify(input.agent, null, 2)}

Stats:
${JSON.stringify(input.stats, null, 2)}

World state:
${JSON.stringify(input.worldState, null, 2)}

Relationships:
${JSON.stringify(input.relationships, null, 2)}

Events:
${JSON.stringify(input.events, null, 2)}

Memories:
${JSON.stringify(input.memories, null, 2)}`
  });

  return agentAnswerSchema.parse(result.object);
}
