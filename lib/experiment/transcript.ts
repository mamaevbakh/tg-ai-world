import type { AgentLabel } from "@/lib/experiment/schemas";
import { getPrivateAnalyses, getPublicEvents } from "@/lib/experiment/db";
import { publicAgentName, publicTargetName } from "@/lib/experiment/labels";

export async function buildFullPublicTranscript(experimentId: string) {
  const events = await getPublicEvents(experimentId);

  return events
    .map((event) => {
      if (event.event_type === "main_turn") {
        return `Hour ${event.hour} - Main Turn\n\n${event.agent_label ? publicAgentName(event.agent_label) : "Unknown"}:\n${event.content}`;
      }

      if (event.event_type === "observer_message") {
        return `Observer ${event.observer_username ?? "unknown"} to ${publicTargetName(event.observer_target)}:\n${event.content}`;
      }

      return `${event.agent_label ? publicAgentName(event.agent_label) : "Unknown"} -> Observer ${event.observer_username ?? "unknown"}:\n${event.content}`;
    })
    .join("\n\n---\n\n");
}

export async function buildPrivateAnalysesText(experimentId: string, agent?: AgentLabel) {
  const analyses = await getPrivateAnalyses(experimentId, agent);

  return analyses
    .map((item) => {
      const hour = item.hour ? `Hour ${item.hour}` : "No hour";
      return `${hour} - ${publicAgentName(item.agent_label)} - ${item.trigger_type}\n${JSON.stringify(item.analysis, null, 2)}`;
    })
    .join("\n\n---\n\n");
}
