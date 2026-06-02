import type { AgentLabel } from "@/lib/experiment/schemas";
import { requireEnv } from "@/lib/env";

function tokenForAgent(agent: AgentLabel) {
  return agent === "A"
    ? requireEnv("TELEGRAM_AGENT_A_BOT_TOKEN")
    : requireEnv("TELEGRAM_AGENT_B_BOT_TOKEN");
}

export function formatAgentTitle(agent: AgentLabel, kind: "main" | "observer", hour?: number, username?: string) {
  const icon = agent === "A" ? "Agent A" : "Agent B";
  if (kind === "main") {
    return `${icon} - Hour ${hour}/72`;
  }

  return `${icon} -> Observer ${username ?? "unknown"}`;
}

export async function sendTelegramMessage(agent: AgentLabel, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${tokenForAgent(agent)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: requireEnv("TELEGRAM_CHAT_ID"),
      text,
      disable_web_page_preview: true
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`Telegram send failed for Agent ${agent}: ${JSON.stringify(payload)}`);
  }

  return String(payload.result?.message_id ?? "");
}

export function renderMainTelegramMessage(agent: AgentLabel, hour: number, message: string) {
  return `${formatAgentTitle(agent, "main", hour)}\n\n${message}`;
}

export function renderObserverTelegramMessage(agent: AgentLabel, username: string, message: string) {
  return `${formatAgentTitle(agent, "observer", undefined, username)}\n\n${message}`;
}
