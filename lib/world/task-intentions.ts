import { sql } from "@/lib/db";
import type { Agent } from "@/lib/world/state";
import {
  loadActiveAgents,
  type World
} from "@/lib/world/state";
import {
  loadAgentInventory,
  loadAgentLocation,
  loadObjectByKey,
  loadVisibleObjectsAtLocation
} from "@/lib/world/map";
import type { AgentTickOutput } from "@/lib/ai/schemas";

export type TaskBlocker =
  | "need_tool"
  | "need_safety_check"
  | "need_permission"
  | "need_location"
  | "need_inventory"
  | "need_energy"
  | "needs_other_agent_confirmation";

export type AgentTaskIntention = {
  id: string;
  world_id: string;
  agent_id: string;
  target_agent_id: string | null;
  title: string;
  status: "active" | "completed" | "blocked" | "abandoned";
  current_step: string | null;
  required_action_type: string | null;
  required_target: string | null;
  required_secondary_target: string | null;
  blockers: TaskBlocker[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  agent_name?: string;
  agent_key?: string | null;
  recent_loop_count?: number;
};

export type SocialConfirmation = {
  id: string;
  world_id: string;
  requester_agent_id: string;
  target_agent_id: string;
  confirmation_type: string;
  subject: string;
  status: string;
  created_at: string;
  expires_tick: number | null;
  requester_name?: string;
  target_name?: string;
};

type IntentTemplate = {
  title: string;
  patterns: RegExp[];
  actionType: string;
  target: string;
  secondaryTarget: string | null;
  step: string;
};

const intentTemplates: IntentTemplate[] = [
  {
    title: "Open Utility Panel Safely",
    patterns: [/open(?:ing)? (?:the )?(?:utility )?panel/i, /utility panel/i, /panel/i],
    actionType: "use_item_on_object",
    target: "bent_screwdriver",
    secondaryTarget: "utility_panel",
    step: "Use bent_screwdriver on utility_panel"
  },
  {
    title: "Check Timestamp Mismatch",
    patterns: [/inspect logs?/i, /check timestamp/i, /timestamp mismatch/i],
    actionType: "inspect_object",
    target: "utility_panel",
    secondaryTarget: null,
    step: "Inspect utility_panel for diagnostics"
  },
  {
    title: "Isolate Local Load",
    patterns: [/isolate (?:the )?local load/i, /isolate load/i],
    actionType: "read_object",
    target: "warning_label",
    secondaryTarget: null,
    step: "Read warning_label before touching the utility panel"
  },
  {
    title: "Seal Northwest Seam",
    patterns: [/seal (?:the )?northwest seam/i, /patch (?:the )?(?:northwest )?seam/i],
    actionType: "repair_object",
    target: "northwest_seam",
    secondaryTarget: null,
    step: "Patch northwest_seam with available cloth"
  },
  {
    title: "Repair Radio",
    patterns: [/repair (?:the )?radio/i, /damaged radio/i],
    actionType: "repair_object",
    target: "damaged_radio",
    secondaryTarget: null,
    step: "Repair damaged_radio with compatible material"
  }
];

function parseBlockers(value: unknown): TaskBlocker[] {
  return Array.isArray(value) ? value.filter((item): item is TaskBlocker => typeof item === "string") : [];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/_/g, " ") : "";
}

function matchesTemplate(text: string, template: IntentTemplate): boolean {
  return template.patterns.some((pattern) => pattern.test(text));
}

export async function listActiveTaskIntentions(worldId: string): Promise<AgentTaskIntention[]> {
  const rows = await sql`
    select ati.*, a.name as agent_name, a.agent_key
    from agent_task_intentions ati
    join agents a on a.id = ati.agent_id
    where ati.world_id = ${worldId} and ati.status = 'active'
    order by a.name asc, ati.updated_at desc
  `;
  return rows.map((row) => ({ ...(row as AgentTaskIntention), blockers: parseBlockers((row as { blockers: unknown }).blockers) }));
}

export async function getActiveTaskIntention(worldId: string, agentId: string): Promise<AgentTaskIntention | null> {
  const [row] = await sql`
    select * from agent_task_intentions
    where world_id = ${worldId} and agent_id = ${agentId} and status = 'active'
    order by updated_at desc
    limit 1
  `;
  return row ? { ...(row as AgentTaskIntention), blockers: parseBlockers((row as { blockers: unknown }).blockers) } : null;
}

export async function upsertTaskIntention(input: {
  worldId: string;
  agentId: string;
  targetAgentId?: string | null;
  title: string;
  currentStep: string;
  requiredActionType: string;
  requiredTarget: string;
  requiredSecondaryTarget?: string | null;
  blockers?: TaskBlocker[];
}): Promise<AgentTaskIntention> {
  const [row] = await sql`
    insert into agent_task_intentions (
      world_id,
      agent_id,
      target_agent_id,
      title,
      current_step,
      required_action_type,
      required_target,
      required_secondary_target,
      blockers
    )
    values (
      ${input.worldId},
      ${input.agentId},
      ${input.targetAgentId ?? null},
      ${input.title},
      ${input.currentStep},
      ${input.requiredActionType},
      ${input.requiredTarget},
      ${input.requiredSecondaryTarget ?? null},
      ${JSON.stringify(input.blockers ?? [])}
    )
    on conflict (world_id, agent_id, lower(title)) where status = 'active'
    do update set
      target_agent_id = excluded.target_agent_id,
      current_step = excluded.current_step,
      required_action_type = excluded.required_action_type,
      required_target = excluded.required_target,
      required_secondary_target = excluded.required_secondary_target,
      blockers = excluded.blockers,
      updated_at = now()
    returning *
  `;
  return { ...(row as AgentTaskIntention), blockers: parseBlockers((row as { blockers: unknown }).blockers) };
}

export async function detectAndUpsertRepeatedIntent(worldId: string, agentId: string): Promise<AgentTaskIntention | null> {
  const rows = await sql`
    select text from (
      select coalesce(message, '') as text, created_at
      from agent_social_turns
      where world_id = ${worldId} and speaker_agent_id = ${agentId}
      union all
      select concat_ws(' ', action_type, target, description, effects::text) as text, created_at
      from agent_actions
      where world_id = ${worldId} and agent_id = ${agentId}
    ) signals
    order by created_at desc
    limit 16
  `;
  const texts = rows.map((row) => String((row as { text: string }).text));
  for (const template of intentTemplates) {
    const count = texts.filter((text) => matchesTemplate(text, template)).length;
    if (count >= 2) {
      return upsertTaskIntention({
        worldId,
        agentId,
        title: template.title,
        currentStep: template.step,
        requiredActionType: template.actionType,
        requiredTarget: template.target,
        requiredSecondaryTarget: template.secondaryTarget
      });
    }
  }
  return null;
}

export async function updateIntentionsFromText(input: {
  worldId: string;
  agentId: string;
  text: string;
}): Promise<AgentTaskIntention | null> {
  const text = input.text.trim();
  if (!text) return null;
  const template = intentTemplates.find((candidate) => matchesTemplate(text, candidate));
  if (!template) return null;

  const recentRows = await sql`
    select count(*)::int as count from (
      select message as text, created_at
      from agent_social_turns
      where world_id = ${input.worldId} and speaker_agent_id = ${input.agentId}
      union all
      select concat_ws(' ', action_type, target, description) as text, created_at
      from agent_actions
      where world_id = ${input.worldId} and agent_id = ${input.agentId}
    ) signals
    where created_at > now() - interval '2 days'
      and lower(text) like ${`%${template.title.toLowerCase().split(" ")[0]}%`}
  `;
  const seenBefore = Number((recentRows[0] as { count: number } | undefined)?.count ?? 0) > 0;
  if (!seenBefore) return null;

  return upsertTaskIntention({
    worldId: input.worldId,
    agentId: input.agentId,
    title: template.title,
    currentStep: template.step,
    requiredActionType: template.actionType,
    requiredTarget: template.target,
    requiredSecondaryTarget: template.secondaryTarget
  });
}

export async function loadActiveSocialConfirmations(worldId: string, currentTick: number): Promise<SocialConfirmation[]> {
  await sql`
    update social_confirmations
    set status = 'expired'
    where world_id = ${worldId}
      and status = 'active'
      and expires_tick is not null
      and expires_tick < ${currentTick}
  `;
  const rows = await sql`
    select sc.*, requester.name as requester_name, target.name as target_name
    from social_confirmations sc
    join agents requester on requester.id = sc.requester_agent_id
    join agents target on target.id = sc.target_agent_id
    where sc.world_id = ${worldId} and sc.status = 'active'
    order by sc.created_at desc
  `;
  return rows as SocialConfirmation[];
}

export async function maybeCreateSocialConfirmation(input: {
  world: World;
  requesterAgentId: string;
  targetAgentId: string;
  message: string;
  intent?: string | null;
  subject?: string | null;
}) {
  const message = input.message.toLowerCase();
  const confirms = ["agree", "promise", "offer", "answer", "plan"].includes(input.intent ?? "") ||
    /\b(ready|watch|monitor|support|nearby|i will|i'll|confirmed|yes)\b/i.test(message);
  if (!confirms) return;

  const subject = input.subject ?? (message.includes("panel") ? "utility_panel" : null);
  if (!subject) return;
  const confirmationType = message.includes("watch") || message.includes("monitor") ? "watch_support" : "readiness";
  await sql`
    insert into social_confirmations (
      world_id,
      requester_agent_id,
      target_agent_id,
      confirmation_type,
      subject,
      expires_tick
    )
    values (${input.world.id}, ${input.requesterAgentId}, ${input.targetAgentId}, ${confirmationType}, ${subject}, ${input.world.tick_count + 3})
  `;
}

export async function buildInventoryTruthContext(worldId: string, agent: Agent) {
  const agentLocation = await loadAgentLocation(worldId, agent.id);
  const activeAgents = await loadActiveAgents(worldId);
  const sameLocationInventories = [];
  const sharedVisibleObjects = agentLocation ? await loadVisibleObjectsAtLocation(worldId, agentLocation.id) : [];

  for (const otherAgent of activeAgents) {
    const location = await loadAgentLocation(worldId, otherAgent.id);
    if (!agentLocation || !location || location.id !== agentLocation.id) continue;
    const inventory = await loadAgentInventory(worldId, otherAgent.id);
    sameLocationInventories.push({
      agent_key: otherAgent.agent_key,
      agent_name: otherAgent.name,
      inventory: inventory.map((item) => ({ key: item.object_key, name: item.name, quantity: item.quantity }))
    });
  }

  return {
    same_location_agent_inventories: sameLocationInventories,
    shared_visible_objects: sharedVisibleObjects.map((object) => ({
      key: object.object_key,
      name: object.name,
      portable: object.is_portable,
      state: object.state
    }))
  };
}

async function agentHasItem(worldId: string, agentId: string, itemKey: string): Promise<boolean> {
  const inventory = await loadAgentInventory(worldId, agentId);
  return inventory.some((item) => item.object_key === itemKey && item.quantity > 0);
}

async function targetVisible(worldId: string, agentId: string, targetKey: string): Promise<boolean> {
  const location = await loadAgentLocation(worldId, agentId);
  const object = await loadObjectByKey(worldId, targetKey);
  return Boolean(location && object && object.location_id === location.id);
}

async function actionSucceeded(worldId: string, agentId: string, actionType: string, target: string): Promise<boolean> {
  const [row] = await sql`
    select id from agent_actions
    where world_id = ${worldId}
      and agent_id = ${agentId}
      and action_type = ${actionType}
      and target = ${target}
      and success = true
    order by created_at desc
    limit 1
  `;
  return Boolean(row);
}

export async function refreshTaskBlockers(input: {
  worldId: string;
  agentId: string;
  intention: AgentTaskIntention;
}): Promise<AgentTaskIntention> {
  const blockers: TaskBlocker[] = [];
  let actionType = input.intention.required_action_type;
  let target = input.intention.required_target;
  let secondaryTarget = input.intention.required_secondary_target;
  let currentStep = input.intention.current_step;

  if (input.intention.title === "Open Utility Panel Safely") {
    const warningRead = await actionSucceeded(input.worldId, input.agentId, "read_object", "warning_label");
    actionType = warningRead ? "use_item_on_object" : "read_object";
    target = warningRead ? "bent_screwdriver" : "warning_label";
    secondaryTarget = warningRead ? "utility_panel" : null;
    currentStep = warningRead
      ? "Use bent_screwdriver on utility_panel"
      : "Read warning_label before opening utility_panel";
    if (!warningRead) blockers.push("need_safety_check");
  }

  if ((actionType === "use_item_on_object" || actionType === "repair_object") && target) {
    const itemKey = actionType === "repair_object" ? "torn_cloth" : target;
    if (!(await agentHasItem(input.worldId, input.agentId, itemKey))) blockers.push("need_tool");
  }

  const objectKey = actionType === "use_item_on_object" ? secondaryTarget : target;
  if (objectKey && !(await targetVisible(input.worldId, input.agentId, objectKey))) blockers.push("need_location");

  const status = blockers.includes("need_tool") || blockers.includes("need_location") ? "blocked" : "active";
  const [row] = await sql`
    update agent_task_intentions
    set blockers = ${JSON.stringify(blockers)},
        status = ${status},
        current_step = ${currentStep},
        required_action_type = ${actionType},
        required_target = ${target},
        required_secondary_target = ${secondaryTarget},
        updated_at = now()
    where id = ${input.intention.id}
    returning *
  `;
  return { ...(row as AgentTaskIntention), blockers: parseBlockers((row as { blockers: unknown }).blockers) };
}

export async function completeMatchingIntention(input: {
  worldId: string;
  agentId: string;
  actionType: string;
  target?: string | null;
  secondaryTarget?: string | null;
  success: boolean;
}) {
  if (!input.success) return;
  await sql`
    update agent_task_intentions
    set status = 'completed',
        completed_at = now(),
        updated_at = now(),
        blockers = '[]'::jsonb
    where world_id = ${input.worldId}
      and agent_id = ${input.agentId}
      and status = 'active'
      and required_action_type = ${input.actionType}
      and coalesce(required_target, '') = coalesce(${input.target ?? null}, '')
      and coalesce(required_secondary_target, '') = coalesce(${input.secondaryTarget ?? null}, '')
      and not (title = 'Open Utility Panel Safely' and required_action_type = 'read_object')
  `;
}

export async function countRecentRepeatedAsks(input: {
  worldId: string;
  agentId: string;
  target?: string | null;
}): Promise<number> {
  const rows = await sql`
    select action_type, target, description, created_at
    from agent_actions
    where world_id = ${input.worldId} and agent_id = ${input.agentId}
    order by created_at desc
    limit 6
  `;
  return rows.filter((row) => {
    const actionType = String((row as { action_type: string }).action_type);
    if (actionType !== "ask_agent") return false;
    const text = `${normalizeText((row as { target?: string | null }).target)} ${normalizeText((row as { description?: string | null }).description)}`;
    const normalizedTarget = normalizeText(input.target);
    return /ready|readiness|permission|watch|support|okay|ok/i.test(text) &&
      (!normalizedTarget || text.includes(normalizedTarget) || (normalizedTarget === "utility panel" && /\b(panel|load|screwdriver|diagnostic)\b/i.test(text)));
  }).length;
}

export async function applyTaskActionPolicy(input: {
  worldId: string;
  agentId: string;
  output: AgentTickOutput;
  activeIntention: AgentTaskIntention | null;
  activeConfirmations: SocialConfirmation[];
}): Promise<AgentTickOutput> {
  if (!input.activeIntention) return input.output;
  const intention = await refreshTaskBlockers({
    worldId: input.worldId,
    agentId: input.agentId,
    intention: input.activeIntention
  });
  if (!intention.required_action_type || !intention.required_target) return input.output;

  const recentAskCount = await countRecentRepeatedAsks({
    worldId: input.worldId,
    agentId: input.agentId
  });
  const hasConfirmation = input.activeConfirmations.some((confirmation) => confirmation.subject === (intention.required_secondary_target ?? intention.required_target));
  const selected = input.output.selected_action;
  const selectedRepeatedAsk = selected.type === "ask_agent" && (recentAskCount >= 2 || hasConfirmation);
  const selectedStaleInspect = selected.type === "inspect_object" &&
    selected.target === intention.required_target &&
    intention.required_action_type !== "inspect_object";

  if (!selectedRepeatedAsk && !selectedStaleInspect) return input.output;

  const targetText = intention.required_secondary_target
    ? `${intention.required_target} -> ${intention.required_secondary_target}`
    : intention.required_target;
  return {
    ...input.output,
    public_message: [
      "Останавливаю повторное согласование и перехожу к следующему проверяемому шагу.",
      "",
      `${intention.current_step ?? intention.title}.`,
      "",
      `Backend action: ${intention.required_action_type} ${targetText}`
    ].join("\n"),
    internal_summary: `${input.output.internal_summary}\n\nAction policy escalated repeated discussion to current task step: ${intention.current_step ?? intention.title}.`,
    selected_action: {
      ...selected,
      type: intention.required_action_type as AgentTickOutput["selected_action"]["type"],
      target: intention.required_target,
      secondary_target: intention.required_secondary_target,
      reason: `Active task intention priority: ${intention.title}.`,
      description: intention.current_step ?? intention.title
    }
  };
}
