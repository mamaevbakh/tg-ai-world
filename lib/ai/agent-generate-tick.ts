import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { env } from "@/lib/env";
import { buildAgentTickPrompt } from "@/lib/ai/prompts";
import { agentTickOutputSchema, type AgentTickOutput } from "@/lib/ai/schemas";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { AgentPerceptionContext } from "@/lib/world/perception";

type GenerateTickInput = {
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
  memories: AgentMemory[];
  phase: string;
  perception?: AgentPerceptionContext;
};

export async function generateAgentTick(input: GenerateTickInput): Promise<AgentTickOutput> {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: agentTickOutputSchema,
    prompt: buildAgentTickPrompt(input),
    temperature: 0.8
  });

  return agentTickOutputSchema.parse(result.object);
}
