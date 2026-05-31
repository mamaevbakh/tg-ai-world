import { Bot } from "grammy";
import type { Message } from "grammy/types";
import { getAdamTelegramBotToken, getEnv } from "@/lib/env";
import type { Agent } from "@/lib/world/state";

const botCache = new Map<string, Bot>();

export function getBotTokenForAgent(agent: Pick<Agent, "agent_key" | "telegram_bot_token_env_key">): string {
  const appEnv = getEnv() as unknown as Record<string, string | undefined>;
  const explicitKey = agent.telegram_bot_token_env_key;
  const normalizedKey = agent.agent_key?.toUpperCase();
  const fallbackKey = normalizedKey ? `TELEGRAM_BOT_TOKEN_${normalizedKey}` : null;
  const token = explicitKey
    ? appEnv[explicitKey] ?? process.env[explicitKey]
    : fallbackKey
      ? appEnv[fallbackKey] ?? process.env[fallbackKey]
      : undefined;

  if (token) {
    return token;
  }

  if (!agent.agent_key || agent.agent_key === "adam") {
    return getAdamTelegramBotToken();
  }

  throw new Error(`Missing Telegram bot token for agent ${agent.agent_key}.`);
}

export function getBotForAgent(agent: Pick<Agent, "agent_key" | "telegram_bot_token_env_key">): Bot {
  const token = getBotTokenForAgent(agent);
  const cached = botCache.get(token);
  if (cached) return cached;

  const bot = new Bot(token);
  botCache.set(token, bot);
  return bot;
}

export async function sendAgentMessage(
  agent: Pick<Agent, "agent_key" | "telegram_bot_token_env_key">,
  chatId: string,
  text: string
): Promise<Message.TextMessage> {
  return getBotForAgent(agent).api.sendMessage(chatId, text);
}
