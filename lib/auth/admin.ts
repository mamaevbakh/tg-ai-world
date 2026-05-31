import type { Context } from "grammy";
import { getTelegramAdminIds } from "@/lib/env";

export function isTelegramAdmin(userId: number | undefined): boolean {
  return Boolean(userId && getTelegramAdminIds().includes(String(userId)));
}

export async function requireAdmin(ctx: Context): Promise<boolean> {
  if (isTelegramAdmin(ctx.from?.id)) {
    return true;
  }

  await ctx.reply("Only Game Masters can use this command.");
  return false;
}
