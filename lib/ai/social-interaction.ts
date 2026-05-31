import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Agent, AgentStats, WorldEvent } from "@/lib/world/state";
import type { Relationship } from "@/lib/world/relationships";
import type { AgentObservation } from "@/lib/world/perception";
import type { WorldLocation } from "@/lib/world/map";
import type { AgentCommitment, JointTask, SocialInteraction, SocialTurn } from "@/lib/world/social";

const relationshipEffectsSchema = z.object({
  trust: z.number().int().min(-5).max(5),
  affinity: z.number().int().min(-5).max(5),
  tension: z.number().int().min(-8).max(8),
  respect: z.number().int().min(-5).max(5),
  fear: z.number().int().min(-5).max(5)
});

const proposedCommitmentSchema = z.object({
  commitment_type: z.enum(["promise", "warning", "agreement", "boundary", "plan", "request", "debt", "condition"]),
  content: z.string().min(1).max(600),
  due_tick: z.number().int().nullable()
}).nullable();

const proposedJointTaskSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1000),
  required_location_key: z.string().nullable(),
  required_object_key: z.string().nullable(),
  steps: z.array(z.object({
    label: z.string().min(1).max(160),
    status: z.enum(["pending", "done"])
  })).max(5)
}).nullable();

const socialInitiationSchema = z.object({
  should_start: z.boolean(),
  interaction_type: z.enum([
    "conversation",
    "request_help",
    "offer_help",
    "warning",
    "disagreement",
    "comfort",
    "trust_check",
    "negotiation",
    "planning",
    "confession",
    "challenge",
    "apology",
    "joint_task_discussion"
  ]),
  topic: z.string().min(1).max(240),
  public_message: z.string().min(0).max(800),
  emotional_tone: z.string().min(1).max(80),
  intent: z.enum(["ask", "answer", "agree", "disagree", "warn", "comfort", "request", "offer", "promise", "refuse", "clarify", "challenge", "apologize", "plan", "end"]),
  proposed_commitment: proposedCommitmentSchema,
  proposed_joint_task: proposedJointTaskSchema,
  relationship_effects: relationshipEffectsSchema
});

const socialResponseSchema = z.object({
  should_respond: z.boolean(),
  public_message: z.string().min(0).max(800),
  emotional_tone: z.string().min(1).max(80),
  intent: z.enum(["ask", "answer", "agree", "disagree", "warn", "comfort", "request", "offer", "promise", "refuse", "clarify", "challenge", "apologize", "plan", "end"]),
  resolve_interaction: z.boolean(),
  proposed_commitment: proposedCommitmentSchema,
  proposed_joint_task: proposedJointTaskSchema,
  relationship_effects: relationshipEffectsSchema
});

export type SocialInitiationOutput = z.infer<typeof socialInitiationSchema>;
export type SocialResponseOutput = z.infer<typeof socialResponseSchema>;

export async function generateSocialInitiation(input: {
  initiatingAgent: Agent;
  targetAgent: Agent;
  relationship: Relationship | null;
  currentLocation: WorldLocation | null;
  recentAction: Record<string, unknown> | null;
  recentObservations: AgentObservation[];
  openCommitments: AgentCommitment[];
  activeJointTasks: JointTask[];
  activeEvents: WorldEvent[];
  activeExperiment: unknown;
  stats: AgentStats;
  recentSocialTurns: SocialTurn[];
  forcedTopic?: string;
}): Promise<SocialInitiationOutput> {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: socialInitiationSchema,
    temperature: 0.7,
    prompt: `You are ${input.initiatingAgent.name}, a simulated inhabitant starting a short purposeful social interaction with ${input.targetAgent.name}.

Rules:
- No long monologues. Use 1-3 short paragraphs.
- Do not prefix your own name.
- Speak like an inhabitant, not an assistant.
- Do not say "as an AI".
- No private chain-of-thought.
- Keep it grounded in current location, recent action, commitments, or concrete concern.
- Start only if there is a meaningful reason unless this was forced by the Game Master.
- If making a promise, proposed_commitment must describe it.
- If proposing cooperation, proposed_joint_task may describe it.
- If disagreeing, give a concrete reason.

Forced topic:
${input.forcedTopic ?? "none"}

Initiating agent:
${JSON.stringify(input.initiatingAgent, null, 2)}

Target agent:
${JSON.stringify(input.targetAgent, null, 2)}

Relationship:
${JSON.stringify(input.relationship, null, 2)}

Current location:
${JSON.stringify(input.currentLocation, null, 2)}

Recent action:
${JSON.stringify(input.recentAction, null, 2)}

Recent observations:
${JSON.stringify(input.recentObservations, null, 2)}

Open commitments:
${JSON.stringify(input.openCommitments, null, 2)}

Active joint tasks:
${JSON.stringify(input.activeJointTasks, null, 2)}

Active events:
${JSON.stringify(input.activeEvents, null, 2)}

Active experiment:
${JSON.stringify(input.activeExperiment, null, 2)}

Stats:
${JSON.stringify(input.stats, null, 2)}

Recent social turns:
${JSON.stringify(input.recentSocialTurns, null, 2)}

If no interaction is warranted, set should_start=false and public_message="".`
  });

  return socialInitiationSchema.parse(result.object);
}

export async function generateSocialResponse(input: {
  interaction: SocialInteraction;
  lastSocialTurn: SocialTurn;
  targetAgent: Agent;
  relationship: Relationship | null;
  targetPerception: unknown;
  openCommitments: AgentCommitment[];
  activeJointTasks: JointTask[];
  stats: AgentStats;
  activeEvents: WorldEvent[];
}): Promise<SocialResponseOutput> {
  const result = await generateObject({
    model: openai(env.OPENAI_MODEL),
    schema: socialResponseSchema,
    temperature: 0.7,
    prompt: `You are ${input.targetAgent.name}, a simulated inhabitant responding briefly to another inhabitant.

Rules:
- No long monologues. Use 1-3 short paragraphs.
- Do not prefix your own name.
- Speak like an inhabitant, not an assistant.
- No private chain-of-thought.
- Do not assume private thoughts.
- You may agree, refuse, warn, comfort, challenge, clarify, make a promise, or end the scene.
- If making a promise, proposed_commitment must describe it.
- If cooperation is proposed, proposed_joint_task may describe it.
- Resolve the interaction if the exchange has reached a useful stopping point.

Interaction:
${JSON.stringify(input.interaction, null, 2)}

Last turn:
${JSON.stringify(input.lastSocialTurn, null, 2)}

Target agent:
${JSON.stringify(input.targetAgent, null, 2)}

Relationship:
${JSON.stringify(input.relationship, null, 2)}

Target perception:
${JSON.stringify(input.targetPerception, null, 2)}

Open commitments:
${JSON.stringify(input.openCommitments, null, 2)}

Active joint tasks:
${JSON.stringify(input.activeJointTasks, null, 2)}

Stats:
${JSON.stringify(input.stats, null, 2)}

Active events:
${JSON.stringify(input.activeEvents, null, 2)}

If a response would be filler, set should_respond=false and public_message="".`
  });

  return socialResponseSchema.parse(result.object);
}
