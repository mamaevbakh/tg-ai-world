import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runTick } from "@/lib/world/tick-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTick({ forced: false, sendTelegram: true });
  return NextResponse.json(result);
}
