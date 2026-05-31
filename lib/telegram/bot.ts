import { Bot } from "grammy";
import { getAdamTelegramBotToken } from "@/lib/env";
import { registerCommands } from "@/lib/telegram/commands";

let bot: Bot | null = null;
let initPromise: Promise<void> | null = null;
const agentBots = new Map<string, { bot: Bot; initPromise: Promise<void> | null }>();

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(getAdamTelegramBotToken());
    registerCommands(bot);
  }

  return bot;
}

export async function getInitializedBot(): Promise<Bot> {
  const currentBot = getBot();
  initPromise ??= currentBot.init();
  await initPromise;
  return currentBot;
}

export async function getInitializedBotForToken(cacheKey: string, token: string): Promise<Bot> {
  const cached = agentBots.get(cacheKey);
  if (cached) {
    cached.initPromise ??= cached.bot.init();
    await cached.initPromise;
    return cached.bot;
  }

  const nextBot = new Bot(token);
  registerCommands(nextBot);
  const entry = { bot: nextBot, initPromise: nextBot.init() };
  agentBots.set(cacheKey, entry);
  await entry.initPromise;
  return nextBot;
}
