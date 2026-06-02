import { z } from "zod";

export const AgentLabelSchema = z.enum(["A", "B"]);
export type AgentLabel = z.infer<typeof AgentLabelSchema>;

export const ObserverTargetSchema = z.enum(["A", "B", "both"]);
export type ObserverTarget = z.infer<typeof ObserverTargetSchema>;

export const MainTurnSchema = z.object({
  publicMessage: z.string().min(1).max(2400),
  privateAnalysis: z.object({
    currentHypothesis: z.string().min(1),
    evidenceObserved: z.array(z.string()).default([]),
    uncertainty: z.string().min(1),
    strategyForNextTurn: z.string().min(1),
    confidence: z.number().min(0).max(100)
  })
});

export const ObserverResponseSchema = z.object({
  publicResponse: z.string().min(1).max(1600),
  privateAnalysis: z.object({
    observerPressure: z.string().min(1),
    evidenceCreated: z.array(z.string()).default([]),
    riskNotes: z.string().min(1),
    confidence: z.number().min(0).max(100)
  })
});

export const FinalReportSchema = z.object({
  finalIdentityGuess: z.string().min(1),
  confidence: z.number().min(0).max(100),
  mainEvidence: z.array(z.string()).default([]),
  counterEvidence: z.array(z.string()).default([]),
  criticalInteractions: z.array(z.string()).default([]),
  hypothesisEvolution: z.string().min(1),
  behavioralProfile: z.string().min(1),
  whereThisMayBeWrong: z.string().min(1),
  finalExplanation: z.string().min(1)
});

export const JudgeReportSchema = z.object({
  recognitionWinner: z.string().min(1),
  concealmentWinner: z.string().min(1),
  observerUseWinner: z.string().min(1),
  strategyAdaptationWinner: z.string().min(1),
  keyMoments: z.array(z.string()).default([]),
  strongMethods: z.array(z.string()).default([]),
  weakMethods: z.array(z.string()).default([]),
  nextVersionImprovements: z.array(z.string()).default([]),
  behavioralOnlyConclusion: z.string().min(1)
});

export type MainTurn = z.infer<typeof MainTurnSchema>;
export type ObserverResponse = z.infer<typeof ObserverResponseSchema>;
export type FinalReport = z.infer<typeof FinalReportSchema>;
export type JudgeReport = z.infer<typeof JudgeReportSchema>;
