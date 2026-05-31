import { NextResponse } from "next/server";
import type { Update } from "grammy/types";
import { env } from "@/lib/env";
import { getBot } from "@/lib/telegram/bot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const update = await request.json() as Update;
    await getBot().handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Telegram webhook failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
