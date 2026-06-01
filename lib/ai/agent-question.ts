import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { Relationship } from "@/lib/world/relationships";
import type { SceneAffordanceContext } from "@/lib/world/scene-affordances";

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
  embodiedState?: unknown;
  sceneContext?: SceneAffordanceContext | null;
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
- Current embodied state is more reliable than memories. If memories mention an old alert or old object state, but current objects say it changed, answer from the current objects.
- Do not claim a panel is still anomalous if current state says alert is dimmed, hum is steady, or a fuse is seated.
- If the Game Master tells you to stop focusing on a completed scene, acknowledge it and name a concrete next visible action or place to move.

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
${JSON.stringify(input.memories, null, 2)}

Current embodied state:
${JSON.stringify(input.embodiedState ?? null, null, 2)}

Scene affordances:
${JSON.stringify(input.sceneContext ?? null, null, 2)}`
  });

  return agentAnswerSchema.parse(result.object);
}
