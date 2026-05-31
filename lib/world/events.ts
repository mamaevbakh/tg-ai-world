import { sql } from "@/lib/db";
import type { WorldEvent } from "@/lib/world/state";

export type CreateWorldEventOnceInput = {
  worldId: string;
  eventType: string;
  title?: string | null;
  content: string;
  severity: number;
  source: string;
  metadata?: Record<string, unknown>;
};

function normalizeEventText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function findSimilarActiveEvent(
  worldId: string,
  eventType: string,
  title: string | null | undefined,
  content: string
): Promise<WorldEvent | null> {
  const rows = await sql`
    select * from world_events
    where world_id = ${worldId}
      and status = 'active'
      and event_type = ${eventType}
    order by created_at asc
  `;
  const normalizedTitle = normalizeEventText(title);
  const normalizedContent = normalizeEventText(content);
  const found = rows.find((event) =>
    normalizeEventText(String(event.title ?? "")) === normalizedTitle &&
    normalizeEventText(String(event.content)) === normalizedContent
  );
  return (found as WorldEvent | undefined) ?? null;
}

export async function createWorldEventOnce(input: CreateWorldEventOnceInput): Promise<WorldEvent> {
  const existing = await findSimilarActiveEvent(input.worldId, input.eventType, input.title, input.content);
  if (existing) return existing;

  const [created] = await sql`
    insert into world_events (world_id, event_type, title, content, severity, source, metadata)
    values (
      ${input.worldId},
      ${input.eventType},
      ${input.title ?? null},
      ${input.content},
      ${input.severity},
      ${input.source},
      ${JSON.stringify(input.metadata ?? {})}
    )
    returning *
  `;
  return created as WorldEvent;
}

export async function resolveDuplicateActiveEvents(worldId: string): Promise<number> {
  const rows = await sql`
    select * from world_events
    where world_id = ${worldId} and status = 'active'
    order by created_at asc
  `;
  const seen = new Map<string, string>();
  const duplicateIds: string[] = [];

  for (const row of rows) {
    const key = [
      String(row.event_type),
      normalizeEventText(String(row.title ?? "")),
      normalizeEventText(String(row.content))
    ].join("|");
    if (seen.has(key)) {
      duplicateIds.push(String(row.id));
    } else {
      seen.set(key, String(row.id));
    }
  }

  if (duplicateIds.length === 0) return 0;

  await sql`
    update world_events
    set status = 'resolved',
        resolved_at = now(),
        metadata = metadata || ${JSON.stringify({ resolved_reason: "duplicate_active_event" })}::jsonb
    where id = any(${duplicateIds}::uuid[])
  `;
  return duplicateIds.length;
}
