import { runNextHour } from "@/lib/experiment/engine";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronSecretFromRequest(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret")
  );
}

export async function POST(request: Request) {
  if (cronSecretFromRequest(request) !== requireEnv("CRON_SECRET")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNextHour();
  return Response.json(result, { status: result.ok ? 200 : 409 });
}

export async function GET(request: Request) {
  if (cronSecretFromRequest(request) !== requireEnv("CRON_SECRET")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNextHour();
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
