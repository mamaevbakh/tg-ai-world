import Link from "next/link";
import {
  addGalyaFromDashboard,
  createWorldFromDashboard,
  injectDashboardEvent,
  runDashboardTick,
  setWorldStatus,
  startDashboardExperiment
} from "@/app/dashboard-actions";
import { loadDashboardData, type DashboardAgent, type DashboardData, type DashboardObject } from "@/lib/dashboard";
import { getPhase } from "@/lib/world/state";

export const dynamic = "force-dynamic";

const statItems = [
  ["Health", "health"],
  ["Energy", "energy"],
  ["Stress", "stress"],
  ["Morale", "morale"],
  ["Fear", "fear"],
  ["Hunger", "hunger"],
  ["Thirst", "thirst"]
] as const;

function shortDate(value: string | null): string {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function actionLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstLines(value: string, maxLength = 220): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

function statusTone(value: number, inverted = false): string {
  const danger = inverted ? value > 70 : value < 35;
  const warning = inverted ? value > 45 : value < 60;
  if (danger) return "bg-rose-500";
  if (warning) return "bg-amber-400";
  return "bg-emerald-400";
}

function Panel({ title, kicker, children, className = "" }: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-zinc-800 bg-zinc-950/70 p-4 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {kicker ? <p className="mb-1 text-xs uppercase text-zinc-500">{kicker}</p> : null}
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatBar({ label, value, inverted = false }: { label: string; value: number; inverted?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-300">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden bg-zinc-800">
        <div className={`h-full ${statusTone(value, inverted)}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function AgentPanel({ agent }: { agent: DashboardAgent }) {
  return (
    <article className="border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-50">{agent.display_name ?? agent.name}</h3>
          <p className="text-sm text-zinc-400">{agent.location_name ?? "Unknown location"}</p>
        </div>
        <span className="border border-zinc-700 px-2 py-1 text-xs uppercase text-zinc-400">{agent.agent_key ?? "agent"}</span>
      </div>
      <p className="mb-4 min-h-10 text-sm text-zinc-300">{agent.short_term_goal ?? agent.main_goal}</p>
      <div className="grid grid-cols-2 gap-3">
        {statItems.map(([label, key]) => (
          <StatBar key={key} label={label} value={agent.stats[key]} inverted={["Stress", "Fear", "Hunger", "Thirst"].includes(label)} />
        ))}
      </div>
    </article>
  );
}

function RoomMap({ data }: { data: DashboardData }) {
  const agentsByLocation = new Map<string, DashboardAgent[]>();
  for (const agent of data.agents) {
    if (!agent.location_key) continue;
    agentsByLocation.set(agent.location_key, [...(agentsByLocation.get(agent.location_key) ?? []), agent]);
  }

  const objectsByLocation = new Map<string, DashboardObject[]>();
  for (const object of data.objects) {
    if (!object.location_key) continue;
    objectsByLocation.set(object.location_key, [...(objectsByLocation.get(object.location_key) ?? []), object]);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.locations.map((location) => {
        const agents = agentsByLocation.get(location.location_key) ?? [];
        const objects = objectsByLocation.get(location.location_key) ?? [];
        return (
          <article
            key={location.id}
            className={`min-h-52 border p-4 ${location.is_discovered ? "border-zinc-800 bg-zinc-900/50" : "border-zinc-900 bg-zinc-950/80 opacity-70"}`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-zinc-100">{location.name}</h3>
                <p className="text-xs text-zinc-500">{location.location_key}</p>
              </div>
              <span className="border border-zinc-700 px-2 py-1 text-xs text-zinc-400">Danger {location.danger_level}</span>
            </div>
            <p className="mb-3 text-sm leading-5 text-zinc-300">{location.description}</p>
            <div className="mb-3 flex min-h-7 flex-wrap gap-2">
              {agents.map((agent) => (
                <span key={agent.id} className="bg-cyan-400 px-2 py-1 text-xs font-medium text-zinc-950">{agent.name}</span>
              ))}
            </div>
            <p className="mb-2 text-xs uppercase text-zinc-500">Objects</p>
            <div className="mb-3 flex min-h-14 flex-wrap content-start gap-2">
              {objects.slice(0, 5).map((object) => (
                <span key={object.id} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{object.name}</span>
              ))}
              {objects.length > 5 ? <span className="px-2 py-1 text-xs text-zinc-500">+{objects.length - 5} more</span> : null}
            </div>
            <p className="text-xs text-zinc-500">
              Exits: {location.exits.map((exit) => `${exit.to_location_name}${exit.is_blocked ? " blocked" : ""}`).join(", ") || "none"}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function Controls({ data }: { data: DashboardData }) {
  const hasGalya = data.agents.some((agent) => agent.agent_key === "galya");
  return (
    <Panel title="Game Master" kicker="Controls">
      <div className="grid gap-3 sm:grid-cols-2">
        <form action={runDashboardTick}>
          <button className="h-11 w-full bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 hover:bg-cyan-200" type="submit">
            Run tick
          </button>
        </form>
        <form action={setWorldStatus}>
          <input type="hidden" name="status" value={data.world?.status === "active" ? "paused" : "active"} />
          <button className="h-11 w-full border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-900" type="submit">
            {data.world?.status === "active" ? "Pause world" : "Resume world"}
          </button>
        </form>
        <form action={addGalyaFromDashboard}>
          <button
            className="h-11 w-full border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={hasGalya}
            type="submit"
          >
            Add Galya
          </button>
        </form>
        <Link className="flex h-11 items-center justify-center border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-900" href="/">
          Refresh
        </Link>
      </div>
      <form action={injectDashboardEvent} className="mt-5 space-y-3">
        <label className="block text-sm font-medium text-zinc-300" htmlFor="event-content">Inject event</label>
        <textarea
          className="min-h-24 w-full resize-y border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
          id="event-content"
          name="content"
          placeholder="A low signal scratches through the damaged radio."
        />
        <div className="flex gap-3">
          <input
            className="h-10 w-24 border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
            defaultValue="2"
            max="5"
            min="1"
            name="severity"
            type="number"
          />
          <button className="h-10 flex-1 bg-zinc-100 px-4 text-sm font-semibold text-zinc-950 hover:bg-white" type="submit">
            Add event
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ExperimentPanel({ data }: { data: DashboardData }) {
  return (
    <Panel title="Experiments" kicker="Scenario pressure">
      {data.activeExperiment ? (
        <div className="mb-4 border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="font-medium text-amber-100">{data.activeExperiment.title}</p>
          <p className="text-sm text-amber-100/80">
            Progress {data.activeExperiment.current_tick_count} / {data.activeExperiment.duration_ticks} ticks
          </p>
        </div>
      ) : data.latestExperiment ? (
        <div className="mb-4 border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="font-medium text-zinc-100">Latest: {data.latestExperiment.title}</p>
          <p className="text-sm text-zinc-400">Status: {data.latestExperiment.status}</p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-zinc-400">No experiment has run yet.</p>
      )}
      <form action={startDashboardExperiment} className="space-y-3">
        <select
          className="h-10 w-full border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
          disabled={Boolean(data.activeExperiment)}
          name="slug"
        >
          {data.experimentTemplates.map((template) => (
            <option key={template.slug} value={template.slug}>{template.title}</option>
          ))}
        </select>
        <div className="flex gap-3">
          <input
            className="h-10 w-24 border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
            defaultValue="3"
            disabled={Boolean(data.activeExperiment)}
            max="20"
            min="1"
            name="duration"
            type="number"
          />
          <button
            className="h-10 flex-1 border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={Boolean(data.activeExperiment)}
            type="submit"
          >
            Start experiment
          </button>
        </div>
      </form>
    </Panel>
  );
}

function EmptyWorld() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
        <p className="mb-3 text-sm uppercase text-cyan-300">AI Society Lab</p>
        <h1 className="mb-4 text-5xl font-semibold">No world is running.</h1>
        <p className="mb-8 max-w-xl text-zinc-300">
          Create the default shelter world to open the live simulation room, agents, events, and scenario controls.
        </p>
        <form action={createWorldFromDashboard}>
          <button className="h-12 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200" type="submit">
            Create world
          </button>
        </form>
      </section>
    </main>
  );
}

export default async function Home() {
  const data = await loadDashboardData();
  if (!data.world || !data.worldState) return <EmptyWorld />;

  const phase = getPhase(data.world.current_hour);
  const resourceEntries = Object.entries(data.worldState.resources ?? {});

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-sm uppercase text-cyan-300">AI Society Lab</p>
            <h1 className="text-4xl font-semibold sm:text-5xl">Living World Dashboard</h1>
            <p className="mt-3 max-w-2xl text-zinc-400">
              Day {data.world.current_day}, {String(data.world.current_hour).padStart(2, "0")}:00, {actionLabel(phase)}. Status: {data.world.status}.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs uppercase text-zinc-500">Ticks</p>
              <p className="text-2xl font-semibold">{data.world.tick_count}</p>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs uppercase text-zinc-500">Agents</p>
              <p className="text-2xl font-semibold">{data.agents.length}</p>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs uppercase text-zinc-500">Events</p>
              <p className="text-2xl font-semibold">{data.events.length}</p>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs uppercase text-zinc-500">Experiment</p>
              <p className="text-sm font-semibold">{data.activeExperiment ? "Active" : "Idle"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_360px] lg:px-8">
        <div className="space-y-5">
          <Panel title="Shelter Map" kicker="Embodied state">
            <RoomMap data={data} />
          </Panel>

          <Panel title="Inhabitants" kicker="Needs and intentions">
            <div className="grid gap-4 lg:grid-cols-2">
              {data.agents.map((agent) => <AgentPanel key={agent.id} agent={agent} />)}
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Live Feed" kicker="Latest messages">
              <div className="space-y-3">
                {data.messages.length ? data.messages.map((message) => (
                  <article key={message.id} className="border-l border-zinc-700 pl-3">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs text-zinc-500">
                      <span>{message.agent_name ?? message.sender_type}</span>
                      <span>{shortDate(message.created_at)}</span>
                    </div>
                    <p className="text-sm leading-6 text-zinc-300">{firstLines(message.content, 260)}</p>
                  </article>
                )) : <p className="text-sm text-zinc-400">No messages yet.</p>}
              </div>
            </Panel>

            <Panel title="Recent Actions" kicker="Mechanical history">
              <div className="space-y-3">
                {data.actions.length ? data.actions.map((action) => (
                  <article key={action.id} className="border-l border-zinc-700 pl-3">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs text-zinc-500">
                      <span>{action.agent_name ?? "Agent"} {"->"} {actionLabel(action.action_type)}</span>
                      <span>{shortDate(action.created_at)}</span>
                    </div>
                    <p className="text-sm text-zinc-300">{firstLines(action.description, 180)}</p>
                    {action.target ? <p className="mt-1 text-xs text-zinc-500">Target: {action.target}</p> : null}
                  </article>
                )) : <p className="text-sm text-zinc-400">No actions yet.</p>}
              </div>
            </Panel>
          </div>
        </div>

        <aside className="space-y-5">
          <Controls data={data} />
          <ExperimentPanel data={data} />

          <Panel title="Resources" kicker="Shared supplies">
            <div className="grid grid-cols-2 gap-3">
              {resourceEntries.map(([key, value]) => (
                <div key={key} className="border border-zinc-800 bg-zinc-900/60 p-3">
                  <p className="text-xs uppercase text-zinc-500">{actionLabel(key)}</p>
                  <p className="text-2xl font-semibold">{Number(value)}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Active Events" kicker="World pressure">
            <div className="space-y-3">
              {data.events.length ? data.events.map((event) => (
                <article key={event.id} className="border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <p className="font-medium text-zinc-100">{event.title ?? actionLabel(event.event_type)}</p>
                    <span className="text-xs text-zinc-500">S{event.severity}</span>
                  </div>
                  <p className="text-sm leading-5 text-zinc-300">{event.content}</p>
                </article>
              )) : <p className="text-sm text-zinc-400">No active events.</p>}
            </div>
          </Panel>

          <Panel title="Social State" kicker="Trust and obligations">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs uppercase text-zinc-500">Relationships</p>
                {data.relationships.length ? data.relationships.slice(0, 6).map((relationship) => (
                  <div key={relationship.id} className="mb-3">
                    <div className="mb-1 flex justify-between text-sm text-zinc-300">
                      <span>{relationship.source_name} {"->"} {relationship.target_name}</span>
                      <span>{relationship.relationship_type}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500">
                      <span>Trust {relationship.trust}</span>
                      <span>Tension {relationship.tension}</span>
                      <span>Respect {relationship.respect}</span>
                    </div>
                  </div>
                )) : <p className="text-sm text-zinc-400">No relationships yet.</p>}
              </div>
              <div>
                <p className="mb-2 text-xs uppercase text-zinc-500">Commitments</p>
                {data.commitments.length ? data.commitments.map((commitment) => (
                  <p key={commitment.id} className="mb-2 text-sm text-zinc-300">{commitment.agent_name}: {commitment.content}</p>
                )) : <p className="text-sm text-zinc-400">No open commitments.</p>}
              </div>
              <div>
                <p className="mb-2 text-xs uppercase text-zinc-500">Joint tasks</p>
                {data.jointTasks.length ? data.jointTasks.map((task) => (
                  <p key={task.id} className="mb-2 text-sm text-zinc-300">{task.title}</p>
                )) : <p className="text-sm text-zinc-400">No active joint tasks.</p>}
              </div>
            </div>
          </Panel>

          <Panel title="Tick Log" kicker="Simulation clock">
            <div className="space-y-3">
              {data.ticks.length ? data.ticks.map((tick) => (
                <article key={tick.id} className="border-l border-zinc-700 pl-3">
                  <div className="flex justify-between gap-3 text-xs text-zinc-500">
                    <span>Tick #{tick.tick_number} - {actionLabel(tick.phase)}</span>
                    <span>{tick.status}</span>
                  </div>
                  {tick.public_message ? <p className="mt-1 text-sm text-zinc-300">{firstLines(tick.public_message, 160)}</p> : null}
                </article>
              )) : <p className="text-sm text-zinc-400">No ticks yet.</p>}
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}
