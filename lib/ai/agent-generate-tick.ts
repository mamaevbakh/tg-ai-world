import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { env } from "@/lib/env";
import { buildAgentTickPrompt } from "@/lib/ai/prompts";
import { agentTickOutputSchema, type AgentTickOutput } from "@/lib/ai/schemas";
import type { Agent, AgentMemory, AgentStats, World, WorldEvent, WorldState } from "@/lib/world/state";
import type { AgentPerceptionContext } from "@/lib/world/perception";
import type { formatLocationContext } from "@/lib/world/map";
import type { AgentCommitment, JointTask, RelationshipEvent, SocialInteraction, SocialTurn } from "@/lib/world/social";
import type { AgentCondition, MoralIncident } from "@/lib/world/ethics";
import type { AgentTaskIntention, SocialConfirmation } from "@/lib/world/task-intentions";
import type { SceneAffordanceContext } from "@/lib/world/scene-affordances";

type GenerateTickInput = {
  world: World;
  agent: Agent;
  stats: AgentStats;
  worldState: WorldState;
  events: WorldEvent[];
  memories: AgentMemory[];
  phase: string;
  perception?: AgentPerceptionContext;
  embodiedContext?: ReturnType<typeof formatLocationContext> | null;
  socialContext?: {
    activeInteractions: SocialInteraction[];
    recentSocialTurns: SocialTurn[];
    openCommitments: AgentCommitment[];
    activeJointTasks: JointTask[];
    recentRelationshipEvents: RelationshipEvent[];
  };
  ethicalContext?: {
    agentConditions: AgentCondition[];
    recentMoralIncidents: MoralIncident[];
  };
  taskContext?: {
    activeIntention: AgentTaskIntention | null;
    activeConfirmations: SocialConfirmation[];
    inventoryTruth: unknown;
  };
  sceneContext?: SceneAffordanceContext | null;
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
