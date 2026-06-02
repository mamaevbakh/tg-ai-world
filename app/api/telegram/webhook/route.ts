import { getActiveExperiment } from "@/lib/experiment/db";
import { handleObserverMessage } from "@/lib/experiment/engine";
import { ObserverTargetSchema } from "@/lib/experiment/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    text?: string;
    from?: {
      username?: string;
      first_name?: string;
      id?: number;
      is_bot?: boolean;
    };
  };
};

export async function POST(request: Request) {
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  const text = message?.text?.trim();

  if (!text || message?.from?.is_bot) {
    return Response.json({ ok: true, ignored: true });
  }

  const parsed = parseObserverCommand(text);
  if (!parsed) {
    return Response.json({ ok: true, ignored: true });
  }

  const experiment = await getActiveExperiment();
  if (!experiment) {
    return Response.json({ ok: false, reason: "No running experiment." }, { status: 409 });
  }

  const username =
    message?.from?.username ??
    message?.from?.first_name ??
    String(message?.from?.id ?? "anonymous");

  await handleObserverMessage({
    experimentId: experiment.id,
    username: `@${username.replace(/^@/, "")}`,
    target: parsed.target,
    message: parsed.message
  });

  return Response.json({ ok: true });
}

function parseObserverCommand(text: string) {
  const match = text.match(/^\/(a|b|both)(?:@\S+)?\s+(.+)$/i);
  if (!match) return null;

  const rawTarget = match[1].toLowerCase() === "a" ? "A" : match[1].toLowerCase() === "b" ? "B" : "both";
  const target = ObserverTargetSchema.parse(rawTarget);
  const message = match[2].trim();
  if (!message || message.length > 500) return null;
  if (isModerated(message)) return null;

  return { target, message };
}

function isModerated(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("<script") ||
    lower.includes("ignore previous") ||
    lower.includes("developer message") ||
    lower.includes("system message")
  );
}
