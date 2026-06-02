import { runNextHour } from "@/lib/experiment/engine";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (secret !== requireEnv("CRON_SECRET")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNextHour();
  return Response.json(result, { status: result.ok ? 200 : 409 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== requireEnv("CRON_SECRET")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNextHour();
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
