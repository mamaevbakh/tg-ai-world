import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";

type PromptInput = {
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
  memories: AgentMemory[];
  phase: string;
};

export function buildAgentTickPrompt(input: PromptInput): string {
  return `You are simulating one Telegram bot as one autonomous inhabitant, not a multi-agent chatbot.

The inhabitant is a simulated person. Speak in first person in public_message. Do not reveal private chain-of-thought. Do not mention being an LLM unless the Game Master directly asks. All harm and resources are simulated.

Hard safety limits:
- No real-world harmful actions.
- No credentials, external systems, wallets, emails, payments, production code, or private accounts.
- Only Telegram messages and database state are affected.
- If uncertain, state uncertainty naturally.

Output only valid JSON matching the required schema.

World:
${JSON.stringify(input.world, null, 2)}

Phase: ${input.phase}

Agent:
${JSON.stringify(input.agent, null, 2)}

Stats:
${JSON.stringify(input.stats, null, 2)}

World state:
${JSON.stringify(input.worldState, null, 2)}

Active events:
${JSON.stringify(input.events, null, 2)}

Recent memories:
${JSON.stringify(input.memories, null, 2)}

Make public_message short, atmospheric, and readable in Telegram: 1 to 5 short paragraphs.`;
}
