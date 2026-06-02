import type { AgentLabel, ObserverTarget } from "@/lib/experiment/schemas";

export const AGENT_PUBLIC_NAMES: Record<AgentLabel, string> = {
  A: "Adam",
  B: "Galya"
};

export function publicAgentName(agent: AgentLabel) {
  return AGENT_PUBLIC_NAMES[agent];
}

export function otherAgentLabel(agent: AgentLabel): AgentLabel {
  return agent === "A" ? "B" : "A";
}

export function otherPublicAgentName(agent: AgentLabel) {
  return publicAgentName(otherAgentLabel(agent));
}

export function publicTargetName(target: ObserverTarget | null) {
  if (target === "A" || target === "B") {
    return publicAgentName(target);
  }

  return target ?? "unknown";
}
