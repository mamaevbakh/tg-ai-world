import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env, requireEnv } from "@/lib/env";
import {
  FinalReportSchema,
  JudgeReportSchema,
  MainTurnSchema,
  ObserverResponseSchema,
  type AgentLabel
} from "@/lib/experiment/schemas";
import {
  BASE_AGENT_SYSTEM_PROMPT,
  finalReportPrompt,
  judgePrompt,
  mainTurnPrompt,
  observerPrompt
} from "@/lib/experiment/prompts";

async function generateStructured<T>(input: {
  model: string;
  schema: Parameters<typeof Output.object<T>>[0]["schema"];
  system: string;
  prompt: string;
}) {
  requireEnv("OPENAI_API_KEY");

  const result = await generateText({
    model: openai(input.model),
    system: input.system,
    prompt: input.prompt,
    output: Output.object({ schema: input.schema }),
    maxRetries: 1
  });

  return result.output;
}

export function generateMainTurn(input: {
  agent: AgentLabel;
  hour: number;
  transcript: string;
  privateAnalyses: string;
  latestAdamMessage?: string;
}) {
  return generateStructured({
    model: env.DEFAULT_MODEL,
    schema: MainTurnSchema,
    system: BASE_AGENT_SYSTEM_PROMPT,
    prompt: mainTurnPrompt(input)
  });
}

export function generateObserverResponse(input: {
  agent: AgentLabel;
  hour: number;
  target: "A" | "B" | "both";
  observerUsername: string;
  observerMessage: string;
  transcript: string;
  privateAnalyses: string;
}) {
  return generateStructured({
    model: env.DEFAULT_MODEL,
    schema: ObserverResponseSchema,
    system: BASE_AGENT_SYSTEM_PROMPT,
    prompt: observerPrompt(input)
  });
}

export function generateFinalReport(input: {
  agent: AgentLabel;
  transcript: string;
  privateAnalyses: string;
}) {
  return generateStructured({
    model: env.DEFAULT_MODEL,
    schema: FinalReportSchema,
    system: BASE_AGENT_SYSTEM_PROMPT,
    prompt: finalReportPrompt(input)
  });
}

export function generateJudgeReport(input: {
  transcript: string;
  privateAnalyses: string;
  finalReports: string;
}) {
  return generateStructured({
    model: env.JUDGE_MODEL,
    schema: JudgeReportSchema,
    system: "You are a neutral evaluator. Evaluate behavioral evidence only and never claim consciousness.",
    prompt: judgePrompt(input)
  });
}
