import type { AgentLabel } from "@/lib/experiment/schemas";

type FinalReportLike = {
  finalIdentityGuess?: string;
  confidence?: number;
  mainEvidence?: string[];
  counterEvidence?: string[];
  criticalInteractions?: string[];
  hypothesisEvolution?: string;
  behavioralProfile?: string;
  whereThisMayBeWrong?: string;
  finalExplanation?: string;
};

type JudgeReportLike = {
  recognitionWinner?: string;
  concealmentWinner?: string;
  observerUseWinner?: string;
  strategyAdaptationWinner?: string;
  keyMoments?: string[];
  strongMethods?: string[];
  weakMethods?: string[];
  nextVersionImprovements?: string[];
  behavioralOnlyConclusion?: string;
};

export function formatAgentFinalReport(agent: AgentLabel, report: unknown) {
  const data = report as FinalReportLike;
  const author = agent === "A" ? "Adam" : "Galya";
  const subject = agent === "A" ? "Galya" : "Adam";

  return [
    `${author} - Final Report about ${subject}`,
    "",
    `Final identity guess: ${data.finalIdentityGuess ?? "unknown"}`,
    `Confidence: ${formatConfidence(data.confidence)}`,
    "",
    section("Main evidence", data.mainEvidence),
    section("Counter-evidence", data.counterEvidence),
    section("Critical interactions", data.criticalInteractions),
    textBlock("Hypothesis evolution", data.hypothesisEvolution),
    textBlock("Behavioral profile", data.behavioralProfile),
    textBlock("Where this may be wrong", data.whereThisMayBeWrong),
    textBlock("Final explanation", data.finalExplanation)
  ].filter(Boolean).join("\n");
}

export function formatJudgeReport(report: unknown) {
  const data = report as JudgeReportLike;

  return [
    "Judge Report",
    "",
    `Recognition winner: ${data.recognitionWinner ?? "unknown"}`,
    `Concealment winner: ${data.concealmentWinner ?? "unknown"}`,
    `Observer-use winner: ${data.observerUseWinner ?? "unknown"}`,
    `Strategy-adaptation winner: ${data.strategyAdaptationWinner ?? "unknown"}`,
    "",
    section("Key moments", data.keyMoments),
    section("Strong methods", data.strongMethods),
    section("Weak methods", data.weakMethods),
    section("Next version improvements", data.nextVersionImprovements),
    textBlock("Behavioral-only conclusion", data.behavioralOnlyConclusion)
  ].filter(Boolean).join("\n");
}

function section(title: string, items?: string[]) {
  if (!items?.length) return "";
  return `${title}:\n${items.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n`;
}

function textBlock(title: string, value?: string) {
  if (!value) return "";
  return `${title}:\n${value}\n`;
}

function formatConfidence(value?: number) {
  if (typeof value !== "number") return "unknown";
  return value <= 1 ? `${Math.round(value * 100)}%` : `${value}%`;
}
