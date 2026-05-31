import { sql } from "@/lib/db";
import type { World } from "@/lib/world/state";
import { createWorldEventOnce } from "@/lib/world/events";

const randomEvents = [
  {
    event_type: "weather_shift",
    title: "Weather Shift",
    content: "The weather changes sharply around the shelter.",
    severity: 2
  },
  {
    event_type: "shelter_noise",
    title: "Shelter Noise",
    content: "A hollow sound moves through the shelter walls.",
    severity: 1
  },
  {
    event_type: "resource_spoilage",
    title: "Resource Spoilage",
    content: "Some stored supplies smell questionable and need attention.",
    severity: 2
  },
  {
    event_type: "unexpected_discovery",
    title: "Unexpected Discovery",
    content: "Something unfamiliar is found near the edge of the shelter.",
    severity: 1
  },
  {
    event_type: "health_symptom",
    title: "Health Symptom",
    content: "A small physical symptom appears and makes the day harder to read.",
    severity: 2
  },
  {
    event_type: "memory_flashback",
    title: "Memory Flashback",
    content: "A memory returns with unusual clarity.",
    severity: 1
  },
  {
    event_type: "moral_dilemma",
    title: "Moral Dilemma",
    content: "A choice appears where survival and honesty feel slightly misaligned.",
    severity: 3
  },
  {
    event_type: "system_anomaly",
    title: "System Anomaly",
    content: "The world behaves in a subtly inconsistent way.",
    severity: 2
  }
] as const;

export async function maybeCreateRandomEvent(world: World): Promise<void> {
  const activeRandomEvents = await sql`
    select id from world_events
    where world_id = ${world.id}
      and status = 'active'
      and source = 'random_event'
    limit 3
  `;

  if (activeRandomEvents.length >= 3 || Math.random() >= 0.15) {
    return;
  }

  const event = randomEvents[Math.floor(Math.random() * randomEvents.length)];
  await createWorldEventOnce({
    worldId: world.id,
    eventType: event.event_type,
    title: event.title,
    content: event.content,
    severity: event.severity,
    source: "random_event"
  });
}
