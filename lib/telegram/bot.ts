import { Bot } from "grammy";
import { env } from "@/lib/env";
import { registerCommands } from "@/lib/telegram/commands";

let bot: Bot | null = null;
let initPromise: Promise<void> | null = null;

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
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
