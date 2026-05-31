import { Bot } from "grammy";
import { env } from "@/lib/env";
import { registerCommands } from "@/lib/telegram/commands";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerCommands(bot);
  }

  return bot;
}
