import type { AgentLabel } from "@/lib/experiment/schemas";
import { getPrivateAnalyses, getPublicEvents } from "@/lib/experiment/db";

export async function buildFullPublicTranscript(experimentId: string) {
  const events = await getPublicEvents(experimentId);

  return events
    .map((event) => {
      if (event.event_type === "main_turn") {
        return `Hour ${event.hour} - Main Turn\n\nAgent ${event.agent_label}:\n${event.content}`;
      }

      if (event.event_type === "observer_message") {
        return `Observer ${event.observer_username ?? "unknown"} to ${event.observer_target}:\n${event.content}`;
      }

      return `Agent ${event.agent_label} -> Observer ${event.observer_username ?? "unknown"}:\n${event.content}`;
    })
    .join("\n\n---\n\n");
}

export async function buildPrivateAnalysesText(experimentId: string, agent?: AgentLabel) {
  const analyses = await getPrivateAnalyses(experimentId, agent);

  return analyses
    .map((item) => {
      const hour = item.hour ? `Hour ${item.hour}` : "No hour";
      return `${hour} - Agent ${item.agent_label} - ${item.trigger_type}\n${JSON.stringify(item.analysis, null, 2)}`;
    })
    .join("\n\n---\n\n");
}
