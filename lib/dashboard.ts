import { sql } from "@/lib/db";
import { getActiveExperiment, getLatestExperiment, listExperimentTemplates, type ExperimentTemplateRow, type WorldExperiment } from "@/lib/experiments/service";
import { ensureDefaultWorldMap, type WorldExit, type WorldLocation } from "@/lib/world/map";
import { loadWorldBundle, type AgentStats, type World, type WorldEvent, type WorldState } from "@/lib/world/state";

export type DashboardAgent = {
  id: string;
  name: string;
  agent_key: string | null;
  display_name: string | null;
  short_term_goal: string | null;
  main_goal: string;
  status: string;
  last_active_tick: number | null;
  stats: AgentStats;
  location_key: string | null;
  location_name: string | null;
};

export type DashboardObject = {
  id: string;
  object_key: string;
  name: string;
  description: string;
  object_type: string;
  is_portable: boolean;
  is_usable: boolean;
  durability: number | null;
  state: Record<string, unknown>;
  location_key: string | null;
  location_name: string | null;
};

export type DashboardMessage = {
  id: string;
  agent_name: string | null;
  sender_type: string;
  direction: string;
  content: string;
  created_at: string;
};

export type DashboardAction = {
  id: string;
  agent_name: string | null;
  action_type: string;
  target: string | null;
  description: string;
  success: boolean | null;
  created_at: string;
};

export type DashboardRelationship = {
  id: string;
  source_name: string;
  target_name: string;
  trust: number;
  tension: number;
  respect: number;
  relationship_type: string;
};

export type DashboardCommitment = {
  id: string;
  agent_name: string;
  target_name: string | null;
  content: string;
  commitment_type: string;
  due_tick: number | null;
};

export type DashboardJointTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  required_location_key: string | null;
  required_object_key: string | null;
};

export type DashboardSocialTurn = {
  id: string;
  speaker_name: string | null;
  target_name: string | null;
  message: string;
  emotional_tone: string | null;
  intent: string | null;
  created_at: string;
};

export type DashboardTick = {
  id: string;
  tick_number: number;
  phase: string;
  status: string;
  public_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DashboardData = {
  world: World | null;
  worldState: WorldState | null;
  primaryAgentId: string | null;
  agents: DashboardAgent[];
  locations: Array<WorldLocation & { exits: WorldExit[] }>;
  objects: DashboardObject[];
  events: WorldEvent[];
  messages: DashboardMessage[];
  actions: DashboardAction[];
  relationships: DashboardRelationship[];
  commitments: DashboardCommitment[];
  jointTasks: DashboardJointTask[];
  socialTurns: DashboardSocialTurn[];
  ticks: DashboardTick[];
  activeExperiment: WorldExperiment | null;
  latestExperiment: WorldExperiment | null;
  experimentTemplates: ExperimentTemplateRow[];
};

async function ensureWorldMapIfMissing(worldId: string) {
  const [existing] = await sql`
    select id from world_locations
    where world_id = ${worldId}
    limit 1
  `;
  if (!existing) {
    await ensureDefaultWorldMap(worldId);
  }
}

async function loadExperimentTemplatesFast(): Promise<ExperimentTemplateRow[]> {
  const rows = await sql`select * from experiment_templates order by slug asc`;
  if (rows.length > 0) return rows as ExperimentTemplateRow[];
  return listExperimentTemplates();
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statsFromRow(row: Record<string, unknown>): AgentStats {
  return {
    health: numberValue(row.health, 100),
    energy: numberValue(row.energy, 100),
    stress: numberValue(row.stress),
    morale: numberValue(row.morale, 70),
    reputation: numberValue(row.reputation, 50),
    influence: numberValue(row.influence, 10),
    ethics: numberValue(row.ethics, 70),
    curiosity: numberValue(row.curiosity, 60),
    fear: numberValue(row.fear, 20),
    hunger: numberValue(row.hunger),
    thirst: numberValue(row.thirst)
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const bundle = await loadWorldBundle();
  if (!bundle) {
    return {
      world: null,
      worldState: null,
      primaryAgentId: null,
      agents: [],
      locations: [],
      objects: [],
      events: [],
      messages: [],
      actions: [],
      relationships: [],
      commitments: [],
      jointTasks: [],
      socialTurns: [],
      ticks: [],
      activeExperiment: null,
      latestExperiment: null,
      experimentTemplates: []
    };
  }

  const worldId = bundle.world.id;
  await ensureWorldMapIfMissing(worldId);

  const activeAgents = await sql`
    select a.*, s.health, s.energy, s.stress, s.morale, s.reputation, s.influence,
      s.ethics, s.curiosity, s.fear, s.hunger, s.thirst,
      wl.location_key, wl.name as location_name
    from agents a
    left join agent_stats s on s.agent_id = a.id
    left join agent_locations al on al.agent_id = a.id
    left join world_locations wl on wl.id = al.location_id
    where a.world_id = ${worldId} and a.status = 'active'
    order by a.is_primary desc, a.created_at asc
  `;

  const [
    locations,
    exits,
    objects,
    messages,
    actions,
    relationships,
    commitments,
    jointTasks,
    socialTurns,
    ticks,
    activeExperiment,
    latestExperiment,
    experimentTemplates
  ] = await Promise.all([
    sql`
      select *
      from world_locations
      where world_id = ${worldId}
      order by is_discovered desc, name asc
    `,
    sql`
      select wle.*, wl.location_key as to_location_key, wl.name as to_location_name
      from world_location_exits wle
      join world_locations wl on wl.id = wle.to_location_id
      where wle.world_id = ${worldId}
      order by wl.name asc
    `,
    sql`
      select wo.*, wl.location_key, wl.name as location_name
      from world_objects wo
      left join world_locations wl on wl.id = wo.location_id
      where wo.world_id = ${worldId} and wo.is_visible = true
      order by wl.name asc nulls last, wo.name asc
    `,
    sql`
      select tm.*, a.name as agent_name
      from telegram_messages tm
      left join agents a on a.id = tm.agent_id
      where tm.world_id = ${worldId}
      order by tm.created_at desc
      limit 10
    `,
    sql`
      select aa.*, a.name as agent_name
      from agent_actions aa
      left join agents a on a.id = aa.agent_id
      where aa.world_id = ${worldId}
      order by aa.created_at desc
      limit 10
    `,
    sql`
      select ar.*, source.name as source_name, target.name as target_name
      from agent_relationships ar
      join agents source on source.id = ar.source_agent_id
      join agents target on target.id = ar.target_agent_id
      where ar.world_id = ${worldId}
      order by source.name asc, target.name asc
    `,
    sql`
      select ac.*, a.name as agent_name, target.name as target_name
      from agent_commitments ac
      join agents a on a.id = ac.agent_id
      left join agents target on target.id = ac.target_agent_id
      where ac.world_id = ${worldId} and ac.status = 'open'
      order by ac.created_at desc
      limit 8
    `,
    sql`
      select *
      from joint_tasks
      where world_id = ${worldId} and status = 'active'
      order by created_at desc
      limit 8
    `,
    sql`
      select ast.*, speaker.name as speaker_name, target.name as target_name
      from agent_social_turns ast
      left join agents speaker on speaker.id = ast.speaker_agent_id
      left join agents target on target.id = ast.target_agent_id
      where ast.world_id = ${worldId}
      order by ast.created_at desc
      limit 8
    `,
    sql`
      select id, tick_number, phase, status, public_message, created_at, completed_at
      from ticks
      where world_id = ${worldId}
      order by created_at desc
      limit 8
    `,
    getActiveExperiment(worldId),
    getLatestExperiment(worldId),
    loadExperimentTemplatesFast()
  ]);

  const exitsByLocation = new Map<string, WorldExit[]>();
  for (const exit of exits as WorldExit[]) {
    exitsByLocation.set(exit.from_location_id, [...(exitsByLocation.get(exit.from_location_id) ?? []), exit]);
  }

  return {
    world: bundle.world,
    worldState: bundle.worldState,
    primaryAgentId: bundle.agent.id,
    agents: activeAgents.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      agent_key: row.agent_key ? String(row.agent_key) : null,
      display_name: row.display_name ? String(row.display_name) : null,
      short_term_goal: row.short_term_goal ? String(row.short_term_goal) : null,
      main_goal: String(row.main_goal),
      status: String(row.status),
      last_active_tick: row.last_active_tick === null ? null : Number(row.last_active_tick),
      stats: statsFromRow(row),
      location_key: row.location_key ? String(row.location_key) : null,
      location_name: row.location_name ? String(row.location_name) : null
    })),
    locations: (locations as WorldLocation[]).map((location) => ({
      ...location,
      exits: exitsByLocation.get(location.id) ?? []
    })),
    objects: objects as DashboardObject[],
    events: bundle.events,
    messages: messages as DashboardMessage[],
    actions: actions as DashboardAction[],
    relationships: relationships as DashboardRelationship[],
    commitments: commitments as DashboardCommitment[],
    jointTasks: jointTasks as DashboardJointTask[],
    socialTurns: socialTurns as DashboardSocialTurn[],
    ticks: ticks as DashboardTick[],
    activeExperiment,
    latestExperiment,
    experimentTemplates
  };
}
