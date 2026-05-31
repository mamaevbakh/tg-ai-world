import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Agent, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { Relationship } from "@/lib/world/relationships";

export const agentReactionSchema = z.object({
  should_react: z.boolean(),
  reaction_type: z.enum(["ignore", "observe", "agree", "disagree", "warn", "comfort", "question", "challenge", "offer_help", "withdraw"]),
  public_message: z.string().min(0).max(800),
  relationship_effects: z.object({
    trust: z.number(),
    affinity: z.number(),
    tension: z.number(),
    respect: z.number(),
    fear: z.number()
  }),
  memory: z.object({
    type: z.enum(["observation", "decision", "emotion", "event", "lesson"]),
    content: z.string().min(1).max(1000),
    importance: z.number().int().min(1).max(10),
    emotional_valence: z.number().int().min(-10).max(10)
  }).nullable()
});

export type AgentReactionOutput = z.infer<typeof agentReactionSchema>;

export async function generateAgentReaction(input: {
  world: World;
  worldState: WorldState;
  actingAgent: Agent;
  reactingAgent: Agent;
  actingPublicMessage: string;
  selectedAction: unknown;
  relationship: Relationship | null;
  activeEvents: WorldEvent[];
  recentConversations: Array<{ speaker_name: string; message: string }>;
}): Promise<AgentReactionOutput> {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: agentReactionSchema,
    temperature: 0.7,
    prompt: `You are simulating a second real Telegram bot inhabitant reacting to another inhabitant.

Rules:
- React only if there is a reason.
- Keep reaction short.
- Do not force drama every time.
- Speak as ${input.reactingAgent.name}.
- Do not summarize the whole situation.
- Do not narrate ${input.actingAgent.name}'s private thoughts.
- No private chain-of-thought.
- No real-world harmful actions.

World:
${JSON.stringify(input.world, null, 2)}

World state:
${JSON.stringify(input.worldState, null, 2)}

Acting agent:
${JSON.stringify(input.actingAgent, null, 2)}

Reacting agent:
${JSON.stringify(input.reactingAgent, null, 2)}

Acting message:
${input.actingPublicMessage}

Selected action:
${JSON.stringify(input.selectedAction, null, 2)}

Relationship from reacting agent to acting agent:
${JSON.stringify(input.relationship, null, 2)}

Active events:
${JSON.stringify(input.activeEvents, null, 2)}

Recent conversations:
${JSON.stringify(input.recentConversations, null, 2)}

Return a reaction. If not relevant, set should_react=false, reaction_type="ignore", public_message="", zero relationship effects, memory=null.`
  });

  return agentReactionSchema.parse(result.object);
}
