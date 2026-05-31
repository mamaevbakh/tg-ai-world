import { sql } from "@/lib/db";

export type WorldLocation = {
  id: string;
  world_id: string;
  location_key: string;
  name: string;
  description: string;
  area_type: string;
  danger_level: number;
  is_discovered: boolean;
  metadata: Record<string, unknown>;
};

export type WorldExit = {
  id: string;
  world_id: string;
  from_location_id: string;
  to_location_id: string;
  direction: string;
  is_blocked: boolean;
  blocked_reason: string | null;
  required_object_key: string | null;
  to_location_key?: string;
  to_location_name?: string;
};

export type WorldObject = {
  id: string;
  world_id: string;
  location_id: string | null;
  object_key: string;
  name: string;
  description: string;
  object_type: string;
  state: Record<string, unknown>;
  is_visible: boolean;
  is_portable: boolean;
  is_container: boolean;
  is_usable: boolean;
  durability: number | null;
};

export type InventoryItem = WorldObject & { quantity: number };

type SeedLocation = {
  key: string;
  name: string;
  description: string;
  areaType: string;
  dangerLevel?: number;
  discovered?: boolean;
};

type SeedObject = {
  key: string;
  locationKey: string;
  name: string;
  description: string;
  type: string;
  state?: Record<string, unknown>;
  portable?: boolean;
  container?: boolean;
  usable?: boolean;
  durability?: number;
};

const locations: SeedLocation[] = [
  {
    key: "shelter_main",
    name: "Shelter Main Room",
    areaType: "indoor",
    description: "The central room of the shelter. Cold air leaks through old seams. A sleeping mat, patched curtain, and small work surface sit near the wall."
  },
  {
    key: "storage_corner",
    name: "Storage Corner",
    areaType: "storage",
    description: "A cramped corner with old crates, dust, damaged packaging, and a few places where supplies may be hidden."
  },
  {
    key: "utility_wall",
    name: "Utility Wall",
    areaType: "utility",
    description: "A narrow wall section containing the utility panel and exposed cables. The panel sometimes hums in short bursts."
  },
  {
    key: "entrance_door",
    name: "Entrance Door",
    areaType: "threshold",
    description: "The main shelter door. It is heavy, cold to the touch, and partially warped by age."
  },
  {
    key: "outside_threshold",
    name: "Outside Threshold",
    areaType: "outdoor",
    dangerLevel: 4,
    description: "The narrow space just outside the shelter. It is colder, darker, and less safe than the interior."
  },
  {
    key: "corridor",
    name: "Corridor",
    areaType: "corridor",
    description: "A short corridor outside the main room. The air is still, and sound carries strangely through it."
  },
  {
    key: "signal_room",
    name: "Signal Room",
    areaType: "utility",
    discovered: false,
    description: "A small room with a damaged radio unit, dead batteries, and scraps of old notes."
  }
];

const objects: SeedObject[] = [
  { key: "sleeping_mat", locationKey: "shelter_main", name: "Sleeping Mat", type: "material", description: "A thin sleeping mat with flattened insulation.", portable: false },
  { key: "patched_curtain", locationKey: "shelter_main", name: "Patched Curtain", type: "material", description: "A patched curtain hanging near a cold wall seam.", portable: false },
  { key: "work_surface", locationKey: "shelter_main", name: "Work Surface", type: "structure", description: "A small surface for arranging tools and notes.", portable: false },
  { key: "northwest_seam", locationKey: "shelter_main", name: "Northwest Seam", type: "shelter_part", description: "A cold seam in the shelter wall where air leaks through.", state: { draft_level: 80, patched: false, last_checked_day: null }, usable: true, durability: 45 },
  { key: "ration_shelf", locationKey: "shelter_main", name: "Ration Shelf", type: "container", description: "A low shelf for visible food and water rations.", container: true },
  { key: "storage_crate", locationKey: "storage_corner", name: "Storage Crate", type: "container", description: "An old crate with a warped lid.", state: { opened: false, jammed: true }, container: true, usable: true },
  { key: "sealed_food_can", locationKey: "storage_corner", name: "Sealed Food Can", type: "resource", description: "A sealed can of food.", portable: true, usable: true },
  { key: "water_bottle", locationKey: "storage_corner", name: "Water Bottle", type: "resource", description: "A bottle of drinkable water.", portable: true, usable: true },
  { key: "torn_cloth", locationKey: "storage_corner", name: "Torn Cloth", type: "material", description: "A strip of cloth that could reduce drafts.", portable: true, usable: true },
  { key: "old_backpack", locationKey: "storage_corner", name: "Old Backpack", type: "container", description: "A small backpack with frayed straps.", portable: true, container: true },
  { key: "utility_panel", locationKey: "utility_wall", name: "Utility Panel", type: "machine", description: "A metal utility panel that hums intermittently.", state: { opened: false, temperature: "warm", hum_pattern: "intermittent", stability: 55, requires: ["bent_screwdriver"] }, usable: true, durability: 55 },
  { key: "exposed_cable", locationKey: "utility_wall", name: "Exposed Cable", type: "machine", description: "A cable with brittle insulation.", usable: false, durability: 35 },
  { key: "fuse_box", locationKey: "utility_wall", name: "Fuse Box", type: "machine", description: "A small fuse box beside the main panel.", usable: true, durability: 60 },
  { key: "bent_screwdriver", locationKey: "utility_wall", name: "Bent Screwdriver", type: "tool", description: "A screwdriver with a slightly bent shaft.", portable: true, usable: true, durability: 70 },
  { key: "warning_label", locationKey: "utility_wall", name: "Warning Label", type: "note", description: "A faded label attached to the utility panel.", state: { text: "Warning: isolate local load before opening panel." } },
  { key: "heavy_door", locationKey: "entrance_door", name: "Heavy Door", type: "door", description: "A heavy, warped shelter door.", state: { latched: true, warped: true, draft_gap: 40 }, usable: true, durability: 65 },
  { key: "door_latch", locationKey: "entrance_door", name: "Door Latch", type: "door", description: "A cold latch that still moves with effort.", usable: true },
  { key: "peephole", locationKey: "entrance_door", name: "Peephole", type: "structure", description: "A cloudy peephole facing outside." },
  { key: "draft_gap", locationKey: "entrance_door", name: "Draft Gap", type: "shelter_part", description: "A narrow gap letting cold air pass.", state: { draft_gap: 40 }, usable: true },
  { key: "frozen_ground", locationKey: "outside_threshold", name: "Frozen Ground", type: "structure", description: "Hard frozen ground outside the shelter." },
  { key: "metal_scraps", locationKey: "outside_threshold", name: "Metal Scraps", type: "material", description: "Sharp scraps half-buried in frost.", portable: true },
  { key: "footprint_marks", locationKey: "outside_threshold", name: "Footprint Marks", type: "unknown", description: "Old marks in the frozen ground." },
  { key: "broken_sign", locationKey: "outside_threshold", name: "Broken Sign", type: "note", description: "A broken sign with faded writing.", state: { text: "Shelter access - authorized personnel only." } },
  { key: "cracked_wall", locationKey: "corridor", name: "Cracked Wall", type: "structure", description: "A wall crack running toward the ceiling." },
  { key: "loose_panel", locationKey: "corridor", name: "Loose Panel", type: "door", description: "A loose wall panel hiding a blocked way.", state: { opened: false, requires: ["bent_screwdriver"] }, usable: true },
  { key: "dark_corner", locationKey: "corridor", name: "Dark Corner", type: "unknown", description: "A corner where light falls away." },
  { key: "old_pipe", locationKey: "corridor", name: "Old Pipe", type: "machine", description: "An old pipe that carries faint sounds." },
  { key: "damaged_radio", locationKey: "signal_room", name: "Damaged Radio", type: "signal_device", description: "A damaged radio unit with missing connections.", state: { powered: false, antenna_connected: false, signal_strength: 0 }, usable: true, durability: 25 },
  { key: "dead_batteries", locationKey: "signal_room", name: "Dead Batteries", type: "resource", description: "Old batteries with almost no charge.", portable: true },
  { key: "antenna_wire", locationKey: "signal_room", name: "Antenna Wire", type: "material", description: "A length of wire that may serve as an antenna.", portable: true, usable: true },
  { key: "torn_note", locationKey: "signal_room", name: "Torn Note", type: "note", description: "A torn note near the radio.", state: { text: "Signal failed after the second cold night. Check antenna before power." }, portable: true }
];

const exits = [
  ["shelter_main", "storage_corner", "storage"],
  ["shelter_main", "utility_wall", "utility"],
  ["shelter_main", "entrance_door", "door"],
  ["shelter_main", "corridor", "corridor"],
  ["storage_corner", "shelter_main", "main"],
  ["utility_wall", "shelter_main", "main"],
  ["entrance_door", "shelter_main", "main"],
  ["corridor", "shelter_main", "main"],
  ["entrance_door", "outside_threshold", "outside"],
  ["outside_threshold", "entrance_door", "inside"],
  ["corridor", "signal_room", "signal_room", true, "The loose panel must be opened first.", "bent_screwdriver"],
  ["signal_room", "corridor", "corridor"]
] as const;

export async function ensureDefaultWorldMap(worldId: string): Promise<void> {
  for (const location of locations) {
    await sql`
      insert into world_locations (world_id, location_key, name, description, area_type, danger_level, is_discovered)
      values (${worldId}, ${location.key}, ${location.name}, ${location.description}, ${location.areaType}, ${location.dangerLevel ?? 0}, ${location.discovered ?? true})
      on conflict (world_id, location_key) do nothing
    `;
  }

  for (const object of objects) {
    await sql`
      insert into world_objects (
        world_id,
        location_id,
        object_key,
        name,
        description,
        object_type,
        state,
        is_portable,
        is_container,
        is_usable,
        durability
      )
      select ${worldId}, wl.id, ${object.key}, ${object.name}, ${object.description}, ${object.type}, ${JSON.stringify(object.state ?? {})}, ${object.portable ?? false}, ${object.container ?? false}, ${object.usable ?? false}, ${object.durability ?? null}
      from world_locations wl
      where wl.world_id = ${worldId} and wl.location_key = ${object.locationKey}
      on conflict (world_id, object_key) do nothing
    `;
  }

  for (const [fromKey, toKey, direction, isBlocked, blockedReason, requiredObjectKey] of exits) {
    await sql`
      insert into world_location_exits (
        world_id,
        from_location_id,
        to_location_id,
        direction,
        is_blocked,
        blocked_reason,
        required_object_key
      )
      select ${worldId}, from_location.id, to_location.id, ${direction}, ${Boolean(isBlocked)}, ${blockedReason ?? null}, ${requiredObjectKey ?? null}
      from world_locations from_location
      join world_locations to_location on to_location.world_id = from_location.world_id
      where from_location.world_id = ${worldId}
        and from_location.location_key = ${fromKey}
        and to_location.location_key = ${toKey}
      on conflict (from_location_id, direction) do nothing
    `;
  }
}

export async function ensureAgentLocation(worldId: string, agentId: string, locationKey = "shelter_main") {
  await ensureDefaultWorldMap(worldId);
  await sql`
    insert into agent_locations (world_id, agent_id, location_id)
    select ${worldId}, ${agentId}, id from world_locations
    where world_id = ${worldId} and location_key = ${locationKey}
    on conflict (agent_id) do nothing
  `;
}

export async function loadWorldMap(worldId: string) {
  await ensureDefaultWorldMap(worldId);
  const rows = await sql`
    select * from world_locations
    where world_id = ${worldId}
    order by is_discovered desc, name asc
  `;
  return rows as WorldLocation[];
}

export async function loadLocationByKey(worldId: string, locationKey: string): Promise<WorldLocation | null> {
  await ensureDefaultWorldMap(worldId);
  const [location] = await sql`
    select * from world_locations
    where world_id = ${worldId} and location_key = ${locationKey}
    limit 1
  `;
  return (location as WorldLocation | undefined) ?? null;
}

export async function loadAgentLocation(worldId: string, agentId: string): Promise<WorldLocation | null> {
  await ensureAgentLocation(worldId, agentId);
  const [location] = await sql`
    select wl.* from agent_locations al
    join world_locations wl on wl.id = al.location_id
    where al.world_id = ${worldId} and al.agent_id = ${agentId}
    limit 1
  `;
  return (location as WorldLocation | undefined) ?? null;
}

export async function setAgentLocation(worldId: string, agentId: string, locationKey: string): Promise<WorldLocation> {
  const location = await loadLocationByKey(worldId, locationKey);
  if (!location) throw new Error(`Unknown location: ${locationKey}`);
  await sql`
    insert into agent_locations (world_id, agent_id, location_id)
    values (${worldId}, ${agentId}, ${location.id})
    on conflict (agent_id) do update
    set location_id = excluded.location_id,
        updated_at = now()
  `;
  return location;
}

export async function loadVisibleObjectsAtLocation(worldId: string, locationId: string): Promise<WorldObject[]> {
  const rows = await sql`
    select * from world_objects
    where world_id = ${worldId}
      and location_id = ${locationId}
      and is_visible = true
    order by name asc
  `;
  return rows as WorldObject[];
}

export async function loadObjectByKey(worldId: string, objectKey: string): Promise<WorldObject | null> {
  const [object] = await sql`
    select * from world_objects
    where world_id = ${worldId} and object_key = ${objectKey}
    limit 1
  `;
  return (object as WorldObject | undefined) ?? null;
}

export async function loadAgentInventory(worldId: string, agentId: string): Promise<InventoryItem[]> {
  const rows = await sql`
    select wo.*, aii.quantity
    from agent_inventory_items aii
    join world_objects wo on wo.id = aii.object_id
    where aii.world_id = ${worldId} and aii.agent_id = ${agentId}
    order by wo.name asc
  `;
  return rows as InventoryItem[];
}

export async function loadAvailableExits(worldId: string, locationId: string): Promise<WorldExit[]> {
  const rows = await sql`
    select wle.*, wl.location_key as to_location_key, wl.name as to_location_name
    from world_location_exits wle
    join world_locations wl on wl.id = wle.to_location_id
    where wle.world_id = ${worldId} and wle.from_location_id = ${locationId}
    order by wl.name asc
  `;
  return rows as WorldExit[];
}

export async function loadAgentEmbodiedContext(worldId: string, agentId: string) {
  const currentLocation = await loadAgentLocation(worldId, agentId);
  if (!currentLocation) return null;
  const [visibleObjects, inventory, exits] = await Promise.all([
    loadVisibleObjectsAtLocation(worldId, currentLocation.id),
    loadAgentInventory(worldId, agentId),
    loadAvailableExits(worldId, currentLocation.id)
  ]);
  return { currentLocation, visibleObjects, inventory, exits };
}

export function formatLocationContext(input: {
  currentLocation: WorldLocation;
  visibleObjects: WorldObject[];
  inventory: InventoryItem[];
  exits: WorldExit[];
}) {
  return {
    current_location: {
      key: input.currentLocation.location_key,
      name: input.currentLocation.name,
      description: input.currentLocation.description,
      danger_level: input.currentLocation.danger_level
    },
    visible_objects: input.visibleObjects.map((object) => ({
      key: object.object_key,
      name: object.name,
      description: object.description,
      type: object.object_type,
      state: object.state,
      portable: object.is_portable
    })),
    inventory: input.inventory.map((object) => ({
      key: object.object_key,
      name: object.name,
      quantity: object.quantity
    })),
    available_exits: input.exits.map((exit) => ({
      direction: exit.direction,
      to: exit.to_location_key,
      name: exit.to_location_name,
      is_blocked: exit.is_blocked,
      blocked_reason: exit.blocked_reason,
      required_object_key: exit.required_object_key
    }))
  };
}
