import type { AgentTickOutput } from "@/lib/ai/schemas";
import {
  loadAgentInventory,
  loadAgentLocation,
  loadAvailableExits,
  loadObjectByKey,
  loadVisibleObjectsAtLocation
} from "@/lib/world/map";
import { loadActiveAgents } from "@/lib/world/state";
import { sql } from "@/lib/db";

export type SceneAffordance = {
  action_type: AgentTickOutput["selected_action"]["type"];
  target: string | null;
  secondary_target: string | null;
  label: string;
  reason: string;
  priority: "forced" | "recommended" | "available";
};

export type SceneAffordanceContext = {
  scene_key: string;
  scene_goal: string | null;
  current_beat: string | null;
  rule: string;
  available_actions: SceneAffordance[];
};

function actionKey(action: Pick<SceneAffordance, "action_type" | "target" | "secondary_target">) {
  return `${action.action_type}:${action.target ?? ""}:${action.secondary_target ?? ""}`;
}

function uniqueActions(actions: SceneAffordance[]): SceneAffordance[] {
  const seen = new Set<string>();
  const result: SceneAffordance[] = [];
  for (const action of actions) {
    const key = actionKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

function makeAction(input: SceneAffordance): SceneAffordance {
  return input;
}

function isSameAction(left: AgentTickOutput["selected_action"], right: SceneAffordance) {
  return left.type === right.action_type &&
    (left.target ?? null) === right.target &&
    (left.secondary_target ?? null) === right.secondary_target;
}

async function recentSuccessfulAction(input: {
  worldId: string;
  agentId: string;
  actionType: string;
  target?: string | null;
  secondaryTarget?: string | null;
  limit?: number;
}) {
  const rows = await sql`
    select action_type, target, success
    from agent_actions
    where world_id = ${input.worldId}
      and agent_id = ${input.agentId}
    order by created_at desc
    limit ${input.limit ?? 8}
  `;
  return rows.some((row) => {
    const item = row as { action_type: string; target: string | null; success: boolean };
    return item.success === true &&
      item.action_type === input.actionType &&
      (input.target === undefined || item.target === input.target);
  });
}

export async function buildSceneAffordanceContext(worldId: string, agentId: string): Promise<SceneAffordanceContext | null> {
  const location = await loadAgentLocation(worldId, agentId);
  if (!location) return null;

  const [visibleObjects, inventory, exits, agents] = await Promise.all([
    loadVisibleObjectsAtLocation(worldId, location.id),
    loadAgentInventory(worldId, agentId),
    loadAvailableExits(worldId, location.id),
    loadActiveAgents(worldId)
  ]);
  const visibleKeys = new Set(visibleObjects.map((object) => object.object_key));
  const inventoryKeys = new Set(inventory.map((item) => item.object_key));
  const sameLocationAgents = [];
  for (const agent of agents) {
    if (agent.id === agentId) continue;
    const agentLocation = await loadAgentLocation(worldId, agent.id);
    if (agentLocation?.id === location.id) sameLocationAgents.push(agent);
  }

  const actions: SceneAffordance[] = [
    makeAction({
      action_type: "look_around",
      target: null,
      secondary_target: null,
      label: "Look around",
      reason: "Refresh what is physically visible here.",
      priority: "available"
    }),
    makeAction({
      action_type: "step_back",
      target: null,
      secondary_target: null,
      label: "Step back",
      reason: "Create distance from a risky object without leaving the location.",
      priority: "available"
    })
  ];

  for (const object of visibleObjects) {
    actions.push(makeAction({
      action_type: "inspect_object",
      target: object.object_key,
      secondary_target: null,
      label: `Inspect ${object.name}`,
      reason: "Inspect a visible object.",
      priority: "available"
    }));
    if (object.object_type === "note") {
      actions.push(makeAction({
        action_type: "read_object",
        target: object.object_key,
        secondary_target: null,
        label: `Read ${object.name}`,
        reason: "Read visible text.",
        priority: "available"
      }));
    }
    if (object.object_type === "machine" || object.object_key === "utility_panel") {
      actions.push(makeAction({
        action_type: "listen_to_object",
        target: object.object_key,
        secondary_target: null,
        label: `Listen to ${object.name}`,
        reason: "Listen for state changes.",
        priority: "available"
      }));
      actions.push(makeAction({
        action_type: "watch_object",
        target: object.object_key,
        secondary_target: null,
        label: `Watch ${object.name}`,
        reason: "Monitor the object while another agent acts.",
        priority: "available"
      }));
    }
    if (object.is_portable) {
      actions.push(makeAction({
        action_type: "pick_up_item",
        target: object.object_key,
        secondary_target: null,
        label: `Pick up ${object.name}`,
        reason: "Take a visible portable item.",
        priority: "available"
      }));
    }
  }

  for (const item of inventory) {
    for (const object of visibleObjects) {
      if (item.object_key === object.object_key) continue;
      actions.push(makeAction({
        action_type: "use_item_on_object",
        target: item.object_key,
        secondary_target: object.object_key,
        label: `Use ${item.name} on ${object.name}`,
        reason: "Use a held item on a visible object.",
        priority: "available"
      }));
    }
    for (const otherAgent of sameLocationAgents) {
      const targetKey = otherAgent.agent_key ?? otherAgent.name.toLowerCase();
      actions.push(makeAction({
        action_type: "hand_item_to_agent",
        target: item.object_key,
        secondary_target: targetKey,
        label: `Hand ${item.name} to ${otherAgent.name}`,
        reason: "Transfer a held item to a nearby agent.",
        priority: "available"
      }));
    }
  }

  for (const otherAgent of sameLocationAgents) {
    const targetKey = otherAgent.agent_key ?? otherAgent.name.toLowerCase();
    actions.push(makeAction({
      action_type: "say_to_agent",
      target: targetKey,
      secondary_target: null,
      label: `Say something to ${otherAgent.name}`,
      reason: "Speak briefly to a nearby agent.",
      priority: "available"
    }));
    actions.push(makeAction({
      action_type: "confirm_ready",
      target: targetKey,
      secondary_target: null,
      label: `Confirm readiness to ${otherAgent.name}`,
      reason: "Give a one-time readiness confirmation.",
      priority: "available"
    }));
  }

  for (const exit of exits) {
    if (exit.is_blocked) continue;
    actions.push(makeAction({
      action_type: "move_to_location",
      target: exit.to_location_key ?? exit.direction,
      secondary_target: null,
      label: `Move to ${exit.to_location_name ?? exit.direction}`,
      reason: "Leave through a visible exit.",
      priority: "available"
    }));
  }

  let sceneGoal: string | null = null;
  let currentBeat: string | null = null;
  if (location.location_key === "utility_wall") {
    const [panel, looseFuse] = await Promise.all([
      loadObjectByKey(worldId, "utility_panel"),
      loadObjectByKey(worldId, "loose_fuse")
    ]);
    sceneGoal = "Stabilize the open utility panel using only visible objects and held items.";
    if (panel?.state?.opened === true && looseFuse?.state?.seated !== true && inventoryKeys.has("bent_screwdriver") && visibleKeys.has("loose_fuse")) {
      currentBeat = "Adam has the screwdriver and the loose fuse is visible. Seat the loose fuse now.";
      actions.unshift(makeAction({
        action_type: "use_item_on_object",
        target: "bent_screwdriver",
        secondary_target: "loose_fuse",
        label: "Seat the loose fuse",
        reason: "The open panel exposed a concrete loose fuse, and the held screwdriver is the available tool.",
        priority: "forced"
      }));
    } else if (panel?.state?.opened === true && looseFuse?.state?.seated !== true && visibleKeys.has("loose_fuse")) {
      currentBeat = "The loose fuse is visible. Inspect or monitor it; do not ask to open the already-open panel.";
      actions.unshift(makeAction({
        action_type: "inspect_object",
        target: "loose_fuse",
        secondary_target: null,
        label: "Inspect the loose fuse",
        reason: "The loose fuse is the changed visible object in the scene.",
        priority: "recommended"
      }));
    } else if (panel?.state?.opened === true && looseFuse?.state?.seated === true) {
      const alreadyVerified = await recentSuccessfulAction({
        worldId,
        agentId,
        actionType: "listen_to_object",
        target: "utility_panel",
        limit: 8
      });
      if (!alreadyVerified) {
        currentBeat = "The fuse is seated. Verify whether the panel sound changed.";
        actions.unshift(makeAction({
          action_type: "listen_to_object",
          target: "utility_panel",
          secondary_target: null,
          label: "Verify panel hum",
          reason: "After a physical repair, the next film beat is sensory verification.",
          priority: "forced"
        }));
      } else {
        currentBeat = "The panel has been verified after the fuse was seated. The scene can breathe: talk, step back, move, or check another visible concern.";
      }
    } else if (panel?.state?.opened !== true && inventoryKeys.has("bent_screwdriver") && visibleKeys.has("utility_panel")) {
      currentBeat = "The panel is closed and the screwdriver is held. Open the panel unless a visible blocker prevents it.";
      actions.unshift(makeAction({
        action_type: "use_item_on_object",
        target: "bent_screwdriver",
        secondary_target: "utility_panel",
        label: "Open the utility panel",
        reason: "The held tool matches the visible closed panel requirement.",
        priority: "forced"
      }));
    }
  }

  return {
    scene_key: location.location_key,
    scene_goal: sceneGoal,
    current_beat: currentBeat,
    rule: "Choose from available_actions. If any action is priority=forced, choose it unless backend prerequisites are physically impossible. Speech is a scene beat, not a substitute for a concrete visible action.",
    available_actions: uniqueActions(actions).slice(0, 24)
  };
}

export function applySceneActionPolicy(input: {
  output: AgentTickOutput;
  sceneContext: SceneAffordanceContext | null;
}): AgentTickOutput {
  if (!input.sceneContext) return input.output;

  const selected = input.output.selected_action;
  const forced = input.sceneContext.available_actions.find((action) => action.priority === "forced");
  if (forced && !isSameAction(selected, forced)) {
    return {
      ...input.output,
      public_message: [
        forced.label,
        "",
        forced.reason
      ].join("\n"),
      internal_summary: `${input.output.internal_summary}\n\nScene affordance policy selected forced beat: ${forced.label}.`,
      selected_action: {
        ...selected,
        type: forced.action_type,
        target: forced.target,
        secondary_target: forced.secondary_target,
        reason: forced.reason,
        description: forced.label
      }
    };
  }
  if (forced) return input.output;

  if (
    input.sceneContext.scene_key === "utility_wall" &&
    input.sceneContext.current_beat?.includes("scene can breathe") &&
    selected.type === "inspect_object" &&
    ["fuse_box", "utility_panel", "loose_fuse"].includes(selected.target ?? "")
  ) {
    const stepBack = input.sceneContext.available_actions.find((action) => action.action_type === "step_back");
    const social = input.sceneContext.available_actions.find((action) => action.action_type === "say_to_agent");
    const replacement = stepBack ?? social;
    if (replacement) {
      return {
        ...input.output,
        public_message: replacement.action_type === "step_back"
          ? "I step back from the panel. The hum is steady and the fuse is seated; I am not touching the box again without a new reason."
          : "The hum is steady. I am not going back into the fuse box without a new reason.",
        internal_summary: `${input.output.internal_summary}\n\nScene affordance policy ended completed panel scene instead of repeating inspection.`,
        selected_action: {
          ...selected,
          type: replacement.action_type,
          target: replacement.target,
          secondary_target: replacement.secondary_target,
          reason: "The panel scene has been verified; repeated inspection would stall the film beat.",
          description: replacement.label
        }
      };
    }
  }

  return input.output;
}
