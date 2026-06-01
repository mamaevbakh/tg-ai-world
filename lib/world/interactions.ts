import { sql } from "@/lib/db";
import { applyStatDelta, type StatKey } from "@/lib/world/effects";
import {
  ensureAgentLocation,
  loadAgentInventory,
  loadAgentLocation,
  loadAvailableExits,
  loadObjectByKey,
  loadVisibleObjectsAtLocation,
  setAgentLocation,
  type WorldLocation,
  type WorldObject
} from "@/lib/world/map";
import type { AgentStats } from "@/lib/world/state";
import type { NewObservation } from "@/lib/world/perception";

export type WorldInteractionResult = {
  success: boolean;
  feedback: string;
  publicSummary?: string;
  statEffects: Record<string, number>;
  objectEffects: Array<{ objectKey: string; statePatch: Record<string, unknown> }>;
  inventoryEffects: Array<{ objectKey: string; quantityDelta: number }>;
  discoveredObjectKeys: string[];
  discoveredLocationKeys: string[];
  createdObservation?: NewObservation;
};

export type WorldInteractionInput = {
  worldId: string;
  agentId: string;
  tickId?: string | null;
  actionType: string;
  target?: string | null;
  secondaryTarget?: string | null;
  stats?: AgentStats;
};

function result(input: Partial<WorldInteractionResult> & { success: boolean; feedback: string }): WorldInteractionResult {
  return {
    publicSummary: input.feedback,
    statEffects: {},
    objectEffects: [],
    inventoryEffects: [],
    discoveredObjectKeys: [],
    discoveredLocationKeys: [],
    ...input
  };
}

function stateLine(object: WorldObject): string {
  const state = Object.entries(object.state ?? {})
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("; ");
  return state ? `${object.description} State: ${state}.` : object.description;
}

async function objectAtAgent(input: WorldInteractionInput, location: WorldLocation): Promise<WorldObject | null> {
  if (!input.target) return null;
  const object = await loadObjectByKey(input.worldId, input.target);
  if (!object) return null;
  const inventory = await loadAgentInventory(input.worldId, input.agentId);
  const inInventory = inventory.some((item) => item.object_key === object.object_key);
  if (object.location_id === location.id || inInventory) return object;
  return null;
}

async function hasInventoryItem(worldId: string, agentId: string, objectKey: string): Promise<boolean> {
  const inventory = await loadAgentInventory(worldId, agentId);
  return inventory.some((item) => item.object_key === objectKey);
}

async function loadSameLocationAgent(input: WorldInteractionInput, location: WorldLocation, agentKey?: string | null): Promise<{ id: string; name: string; agent_key: string | null } | null> {
  if (!agentKey) return null;
  const [agent] = await sql`
    select a.id, a.name, a.agent_key
    from agents a
    join agent_locations al on al.agent_id = a.id
    where a.world_id = ${input.worldId}
      and a.status = 'active'
      and a.id <> ${input.agentId}
      and al.location_id = ${location.id}
      and lower(coalesce(a.agent_key, a.name)) = lower(${agentKey})
    limit 1
  `;
  return (agent as { id: string; name: string; agent_key: string | null } | undefined) ?? null;
}

async function patchObjectState(worldId: string, objectKey: string, statePatch: Record<string, unknown>) {
  const object = await loadObjectByKey(worldId, objectKey);
  if (!object) return;
  await sql`
    update world_objects
    set state = ${JSON.stringify({ ...(object.state ?? {}), ...statePatch })},
        updated_at = now()
    where id = ${object.id}
  `;
}

async function logInteraction(input: WorldInteractionInput, location: WorldLocation | null, object: WorldObject | null, output: WorldInteractionResult) {
  await sql`
    insert into object_interactions (world_id, agent_id, tick_id, location_id, object_id, action_type, success, feedback, effects)
    values (${input.worldId}, ${input.agentId}, ${input.tickId ?? null}, ${location?.id ?? null}, ${object?.id ?? null}, ${input.actionType}, ${output.success}, ${output.feedback}, ${JSON.stringify(output)})
  `;
}

export function applyInteractionStats(stats: AgentStats, effects: Record<string, number>): AgentStats {
  let next = stats;
  for (const [key, amount] of Object.entries(effects)) {
    next = applyStatDelta(next, key as StatKey, amount, 10);
  }
  return next;
}

export async function executeWorldInteraction(input: WorldInteractionInput): Promise<WorldInteractionResult> {
  await ensureAgentLocation(input.worldId, input.agentId);
  const location = await loadAgentLocation(input.worldId, input.agentId);
  if (!location) {
    const output = result({ success: false, feedback: "The agent has no known location." });
    await logInteraction(input, null, null, output);
    return output;
  }

  let object: WorldObject | null = null;
  let output: WorldInteractionResult;

  switch (input.actionType) {
    case "look_around": {
      const [objects, exits] = await Promise.all([
        loadVisibleObjectsAtLocation(input.worldId, location.id),
        loadAvailableExits(input.worldId, location.id)
      ]);
      output = result({
        success: true,
        feedback: `${location.description}\n\nVisible: ${objects.map((item) => item.name).join(", ") || "nothing obvious"}.\nExits: ${exits.map((exit) => exit.to_location_name).join(", ") || "none"}.`,
        statEffects: { energy: -1, curiosity: 1 },
        createdObservation: {
          observation_type: "world",
          subject: location.location_key,
          content: `At ${location.name}: ${location.description}`,
          confidence: 90,
          importance: 4,
          emotional_valence: location.danger_level > 2 ? -2 : 0,
          visibility: "private_to_agent"
        }
      });
      break;
    }
    case "move_to_location": {
      const targetKey = input.target;
      if (!targetKey) {
        output = result({ success: false, feedback: "No destination was chosen." });
        break;
      }
      const exits = await loadAvailableExits(input.worldId, location.id);
      const exit = exits.find((item) => item.to_location_key === targetKey || item.direction === targetKey);
      if (!exit) {
        output = result({ success: false, feedback: `There is no reachable exit from ${location.name} to ${targetKey}.` });
        break;
      }
      if (exit.is_blocked) {
        output = result({ success: false, feedback: exit.blocked_reason ?? "The way is blocked." });
        break;
      }
      const nextLocation = await setAgentLocation(input.worldId, input.agentId, String(exit.to_location_key));
      await sql`update world_locations set is_discovered = true, updated_at = now() where id = ${nextLocation.id}`;
      output = result({
        success: true,
        feedback: `Moved to ${nextLocation.name}. ${nextLocation.description}`,
        statEffects: { energy: -2, fear: nextLocation.danger_level > 2 ? 1 : 0 },
        discoveredLocationKeys: [nextLocation.location_key]
      });
      break;
    }
    case "inspect_object": {
      object = await objectAtAgent(input, location);
      if (!object) {
        output = result({ success: false, feedback: `The object ${input.target ?? ""} is not visible here or in inventory.` });
        break;
      }
      output = result({
        success: true,
        feedback: stateLine(object),
        statEffects: { energy: -2, curiosity: 2 },
        createdObservation: {
          observation_type: object.object_type === "machine" ? "system" : "world",
          subject: object.object_key,
          content: stateLine(object),
          confidence: 85,
          importance: 5,
          emotional_valence: object.object_type === "unknown" ? -1 : 0,
          visibility: "private_to_agent"
        }
      });
      break;
    }
    case "watch_object": {
      object = await objectAtAgent(input, location);
      if (!object || object.location_id !== location.id) {
        output = result({ success: false, feedback: `The object ${input.target ?? ""} is not visible here.` });
        break;
      }
      output = result({
        success: true,
        feedback: `Watched ${object.name} for visible changes. ${stateLine(object)}`,
        statEffects: { energy: -1, curiosity: 1 },
        createdObservation: {
          observation_type: object.object_type === "machine" ? "system" : "world",
          subject: object.object_key,
          content: `Watched ${object.name}: ${stateLine(object)}`,
          confidence: 80,
          importance: 4,
          emotional_valence: object.object_key === "exposed_cable" ? -1 : 0,
          visibility: "private_to_agent"
        }
      });
      break;
    }
    case "step_back": {
      output = result({
        success: true,
        feedback: `Stepped back at ${location.name}, keeping the visible hazards in view.`,
        statEffects: { stress: -1, fear: -1 }
      });
      break;
    }
    case "say_to_agent":
    case "confirm_ready": {
      const targetAgent = await loadSameLocationAgent(input, location, input.target);
      if (!targetAgent) {
        output = result({ success: false, feedback: `No nearby agent matched ${input.target ?? ""}.` });
        break;
      }
      output = result({
        success: true,
        feedback: input.actionType === "confirm_ready"
          ? `Confirmed readiness to ${targetAgent.name}.`
          : `Spoke to ${targetAgent.name}.`,
        statEffects: { influence: 1, morale: input.actionType === "confirm_ready" ? 1 : 0 }
      });
      break;
    }
    case "hand_item_to_agent": {
      const itemKey = input.target;
      const targetAgent = await loadSameLocationAgent(input, location, input.secondaryTarget);
      if (!itemKey || !targetAgent) {
        output = result({ success: false, feedback: "A held item and nearby target agent are required." });
        break;
      }
      const item = await loadObjectByKey(input.worldId, itemKey);
      if (!item || !(await hasInventoryItem(input.worldId, input.agentId, item.object_key))) {
        output = result({ success: false, feedback: `${itemKey} is not in inventory.` });
        break;
      }
      await sql`
        delete from agent_inventory_items
        where world_id = ${input.worldId}
          and agent_id = ${input.agentId}
          and object_id = ${item.id}
      `;
      await sql`
        insert into agent_inventory_items (world_id, agent_id, object_id, quantity)
        values (${input.worldId}, ${targetAgent.id}, ${item.id}, 1)
        on conflict (agent_id, object_id) do update
        set quantity = agent_inventory_items.quantity + 1,
            updated_at = now()
      `;
      output = result({
        success: true,
        feedback: `Handed ${item.name} to ${targetAgent.name}.`,
        statEffects: { morale: 1, influence: 1 },
        inventoryEffects: [{ objectKey: item.object_key, quantityDelta: -1 }]
      });
      break;
    }
    case "pick_up_item": {
      object = await objectAtAgent(input, location);
      if (!object || object.location_id !== location.id) {
        output = result({ success: false, feedback: `The item ${input.target ?? ""} is not available here.` });
        break;
      }
      if (!object.is_portable) {
        output = result({ success: false, feedback: `${object.name} is fixed in place and cannot be picked up.` });
        break;
      }
      await sql`
        insert into agent_inventory_items (world_id, agent_id, object_id, quantity)
        values (${input.worldId}, ${input.agentId}, ${object.id}, 1)
        on conflict (agent_id, object_id) do update
        set quantity = agent_inventory_items.quantity + 1,
            updated_at = now()
      `;
      await sql`update world_objects set location_id = null, updated_at = now() where id = ${object.id}`;
      output = result({
        success: true,
        feedback: `Picked up ${object.name}.`,
        statEffects: { energy: -1 },
        inventoryEffects: [{ objectKey: object.object_key, quantityDelta: 1 }]
      });
      break;
    }
    case "open_container": {
      object = await objectAtAgent(input, location);
      if (!object) {
        output = result({ success: false, feedback: `The container ${input.target ?? ""} is not visible here or in inventory.` });
        break;
      }
      if (!object.is_container) {
        output = result({ success: false, feedback: `${object.name} is not a container.` });
        break;
      }
      const jammed = object.state?.jammed === true;
      if (jammed && !(await hasInventoryItem(input.worldId, input.agentId, "bent_screwdriver"))) {
        output = result({ success: false, feedback: `${object.name} is jammed. A tool may help open it.` });
        break;
      }
      await patchObjectState(input.worldId, object.object_key, { opened: true, jammed: false });
      output = result({
        success: true,
        feedback: `${object.name} opens. Anything visible in it can now be inspected or picked up.`,
        statEffects: { energy: -3, curiosity: 2 },
        objectEffects: [{ objectKey: object.object_key, statePatch: { opened: true, jammed: false } }]
      });
      break;
    }
    case "use_item": {
      const item = input.target ? await loadObjectByKey(input.worldId, input.target) : null;
      if (!item || !(await hasInventoryItem(input.worldId, input.agentId, item.object_key))) {
        output = result({ success: false, feedback: `The item ${input.target ?? ""} is not in inventory.` });
        break;
      }
      const consumables: Record<string, { feedback: string; statEffects: Record<string, number> }> = {
        sealed_food_can: { feedback: "Ate the sealed food can. Hunger drops, but the can is gone.", statEffects: { hunger: -25, morale: 2 } },
        water_bottle: { feedback: "Drank the water bottle. Thirst drops, and the bottle is now empty.", statEffects: { thirst: -30, stress: -2 } },
        medicine: { feedback: "Used medicine. Health improves.", statEffects: { health: 20, stress: -5 } }
      };
      const consumable = consumables[item.object_key];
      if (!consumable) {
        output = result({ success: false, feedback: `${item.name} has no direct use by itself.` });
        break;
      }
      await sql`delete from agent_inventory_items where world_id = ${input.worldId} and agent_id = ${input.agentId} and object_id = ${item.id}`;
      output = result({
        success: true,
        feedback: consumable.feedback,
        statEffects: consumable.statEffects,
        inventoryEffects: [{ objectKey: item.object_key, quantityDelta: -1 }]
      });
      break;
    }
    case "use_item_on_object":
    case "repair_object": {
      const itemKey = input.actionType === "repair_object" ? "torn_cloth" : input.target;
      const objectKey = input.actionType === "repair_object" ? input.target : input.secondaryTarget;
      if (!itemKey || !objectKey) {
        output = result({ success: false, feedback: "Both an item and an object are required." });
        break;
      }
      if (!(await hasInventoryItem(input.worldId, input.agentId, itemKey))) {
        output = result({ success: false, feedback: `${itemKey} is not in inventory.` });
        break;
      }
      object = await loadObjectByKey(input.worldId, objectKey);
      if (!object || object.location_id !== location.id) {
        output = result({ success: false, feedback: `${objectKey} is not visible at ${location.name}.` });
        break;
      }
      const combo = `${itemKey}:${object.object_key}`;
      if (combo === "bent_screwdriver:utility_panel" && object.state?.opened === true) {
        output = result({
          success: false,
          feedback: "Utility Panel is already open. Inspect fuse_box or loose_fuse_visible instead of opening it again."
        });
        break;
      }
      const patches: Record<string, { patch: Record<string, unknown>; feedback: string; stats?: Record<string, number> }> = {
        "bent_screwdriver:utility_panel": {
          patch: { opened: true, loose_fuse_visible: true },
          feedback: "The panel opens with a scrape. A loose fuse is visible inside.",
          stats: { energy: -3, curiosity: 3 }
        },
        "bent_screwdriver:loose_fuse": {
          patch: { seated: true },
          feedback: "The loose fuse clicks back into its socket. The panel hum steadies and the amber alert dims.",
          stats: { energy: -3, curiosity: 3, morale: 3 }
        },
        "torn_cloth:northwest_seam": {
          patch: { patched: true, draft_level: 50 },
          feedback: "The cloth reduces the draft, but the seam still leaks cold air.",
          stats: { energy: -4, morale: 2 }
        },
        "antenna_wire:damaged_radio": {
          patch: { antenna_connected: true, signal_strength: 20 },
          feedback: "The antenna wire connects to the damaged radio. The signal meter twitches but stays weak.",
          stats: { energy: -4, curiosity: 4 }
        },
        "bent_screwdriver:loose_panel": {
          patch: { opened: true },
          feedback: "The loose panel opens. The way toward the signal room is no longer blocked.",
          stats: { energy: -3, curiosity: 4 }
        }
      };
      const interaction = patches[combo];
      if (!interaction) {
        output = result({ success: false, feedback: `${itemKey} does not seem useful on ${object.name}.` });
        break;
      }
      await patchObjectState(input.worldId, object.object_key, interaction.patch);
      if (combo === "bent_screwdriver:utility_panel") {
        await sql`
          insert into world_objects (world_id, location_id, object_key, name, object_type, description, state, is_visible, is_usable, is_portable, durability)
          values (
            ${input.worldId},
            ${location.id},
            'loose_fuse',
            'Loose Fuse',
            'machine_part',
            'A fuse sitting loose inside the opened utility panel.',
            ${JSON.stringify({ seated: false, visible_after: "utility_panel.opened" })}::jsonb,
            true,
            true,
            false,
            45
          )
          on conflict (world_id, object_key) do update
          set location_id = excluded.location_id,
              is_visible = true,
              state = world_objects.state || ${JSON.stringify({ seated: false, visible_after: "utility_panel.opened" })}::jsonb,
              updated_at = now()
        `;
      }
      if (combo === "bent_screwdriver:loose_fuse") {
        await patchObjectState(input.worldId, "utility_panel", {
          stability: 70,
          hum_pattern: "steady",
          alert: "dimmed"
        });
      }
      if (combo === "bent_screwdriver:loose_panel") {
        await sql`
          update world_location_exits
          set is_blocked = false,
              blocked_reason = null
          where world_id = ${input.worldId} and required_object_key = 'bent_screwdriver'
        `;
        await sql`
          update world_locations
          set is_discovered = true,
              updated_at = now()
          where world_id = ${input.worldId} and location_key = 'signal_room'
        `;
      }
      output = result({
        success: true,
        feedback: interaction.feedback,
        statEffects: interaction.stats ?? { energy: -3 },
        objectEffects: [{ objectKey: object.object_key, statePatch: interaction.patch }],
        discoveredLocationKeys: combo === "bent_screwdriver:loose_panel" ? ["signal_room"] : []
      });
      break;
    }
    case "listen_to_object": {
      object = await objectAtAgent(input, location);
      if (!object) {
        output = result({ success: false, feedback: `The object ${input.target ?? ""} is not visible here or in inventory.` });
        break;
      }
      const sound = object.object_key === "utility_panel"
        ? `The utility panel hum is ${String(object.state?.hum_pattern ?? "faint")}; the casing feels ${String(object.state?.temperature ?? "unknown")}.`
        : object.object_key === "old_pipe"
          ? "The old pipe carries a distant, hollow tick every few seconds."
          : object.object_key === "heavy_door"
            ? "The heavy door creaks softly when wind presses against the gap."
            : `${object.name} makes no clear sound.`;
      output = result({
        success: true,
        feedback: sound,
        statEffects: { energy: -1, curiosity: 1 },
        createdObservation: {
          observation_type: "sound",
          subject: object.object_key,
          content: sound,
          confidence: 80,
          importance: 5,
          emotional_valence: object.object_key === "utility_panel" ? -1 : 0,
          visibility: "private_to_agent"
        }
      });
      break;
    }
    case "read_object": {
      object = await objectAtAgent(input, location);
      if (!object) {
        output = result({ success: false, feedback: `The object ${input.target ?? ""} is not visible here or in inventory.` });
        break;
      }
      const text = object.state?.text;
      output = typeof text === "string"
        ? result({ success: true, feedback: `${object.name} says: "${text}"`, statEffects: { curiosity: 2 } })
        : result({ success: false, feedback: `${object.name} has no readable text.` });
      break;
    }
    case "share_discovery":
      output = result({ success: true, feedback: "The discovery is shared publicly.", statEffects: { influence: 1, morale: 1 } });
      break;
    default:
      output = result({ success: false, feedback: `Action ${input.actionType} is not an embodied world interaction.` });
  }

  await logInteraction(input, location, object, output);
  return output;
}
