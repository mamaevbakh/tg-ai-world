import { NextResponse } from "next/server";
import type { Update } from "grammy/types";
import { env, getEnv } from "@/lib/env";
import { getInitializedBotForToken } from "@/lib/telegram/bot";

export const runtime = "nodejs";

function tokenForAgentKey(agentKey: string): string {
  const normalized = agentKey.toLowerCase();
  const appEnv = getEnv() as unknown as Record<string, string | undefined>;
  const envKey = `TELEGRAM_BOT_TOKEN_${normalized.toUpperCase()}`;
  const token = appEnv[envKey] ?? process.env[envKey];
  if (token) return token;
  if (normalized === "adam") return env.TELEGRAM_BOT_TOKEN;
  throw new Error(`Missing Telegram bot token for ${agentKey}.`);
}

export async function POST(request: Request, context: { params: Promise<{ agentKey: string }> }) {
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { agentKey } = await context.params;
    const update = await request.json() as Update;
    const bot = await getInitializedBotForToken(agentKey.toLowerCase(), tokenForAgentKey(agentKey));
    await bot.handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Agent webhook failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
