import {
  createExperimentAction,
  finalizeAction,
  forceNextHourAction,
  setHourAction,
  setStatusAction
} from "@/app/admin/actions";
import {
  getFinalReports,
  getLatestExperiment,
  getPublicEvents,
  getRecentLogs
} from "@/lib/experiment/db";
import { buildFullPublicTranscript } from "@/lib/experiment/transcript";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const data = await loadAdminData();

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-5">
          <p className="text-sm text-zinc-500">72-hour experiment control</p>
          <h1 className="text-2xl font-semibold">Social-Cognitive Identity Detection</h1>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <Panel title="Experiment">
            {data.error ? (
              <p className="text-sm text-red-700">{data.error}</p>
            ) : data.experiment ? (
              <div className="space-y-2 text-sm">
                <p><b>Status:</b> {data.experiment.status}</p>
                <p><b>Hour:</b> {data.experiment.current_hour} / {data.experiment.total_hours}</p>
                <p><b>Title:</b> {data.experiment.title}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No experiment yet.</p>
            )}
          </Panel>

          <Panel title="Controls">
            <SecretForm action={createExperimentAction}>
              <input className="field" name="title" placeholder="Experiment title" />
              <button className="button" type="submit">Create experiment</button>
            </SecretForm>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {["running", "paused", "draft"].map((status) => (
                <SecretForm key={status} action={setStatusAction}>
                  <input type="hidden" name="status" value={status} />
                  <button className="button-secondary w-full" type="submit">{status}</button>
                </SecretForm>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <SecretForm action={forceNextHourAction}>
                <button className="button w-full" type="submit">Force next hour</button>
              </SecretForm>
              <SecretForm action={finalizeAction}>
                <button className="button-secondary w-full" type="submit">Finalize</button>
              </SecretForm>
            </div>

            <SecretForm action={setHourAction} className="mt-4 flex gap-2">
              <input className="field min-w-0" name="hour" type="number" min="1" max="73" placeholder="Hour" />
              <button className="button-secondary" type="submit">Set</button>
            </SecretForm>
          </Panel>

          <Panel title="Endpoints">
            <div className="space-y-2 text-sm text-zinc-700">
              <p><code>/api/cron/tick</code></p>
              <p><code>/api/telegram/webhook</code></p>
            </div>
          </Panel>
        </aside>

        <div className="space-y-6">
          <Panel title="Recent Public Events">
            <div className="space-y-3">
              {data.events.map((event) => (
                <article key={event.id} className="border-b border-zinc-200 pb-3 text-sm last:border-0">
                  <p className="text-xs uppercase text-zinc-500">
                    {event.event_type} {event.agent_label ? `Agent ${event.agent_label}` : ""} {event.hour ? `Hour ${event.hour}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{event.content}</p>
                </article>
              ))}
              {data.events.length === 0 ? <p className="text-sm text-zinc-500">No events yet.</p> : null}
            </div>
          </Panel>

          <Panel title="Full Transcript">
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-zinc-800">
              {data.transcript || "No transcript yet."}
            </pre>
          </Panel>

          <Panel title="Final Reports">
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-zinc-800">
              {data.reports.length ? JSON.stringify(data.reports, null, 2) : "No final reports yet."}
            </pre>
          </Panel>

          <Panel title="Errors">
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-zinc-800">
              {data.logs.length ? JSON.stringify(data.logs, null, 2) : "No errors logged."}
            </pre>
          </Panel>
        </div>
      </section>
    </main>
  );
}

async function loadAdminData() {
  try {
    const experiment = await getLatestExperiment();
    if (!experiment) {
      return { experiment, events: [], transcript: "", reports: [], logs: [], error: "" };
    }

    const [events, transcript, reports, logs] = await Promise.all([
      getPublicEvents(experiment.id),
      buildFullPublicTranscript(experiment.id),
      getFinalReports(experiment.id),
      getRecentLogs(experiment.id)
    ]);

    return { experiment, events: events.slice(-20).reverse(), transcript, reports, logs, error: "" };
  } catch (error) {
    return {
      experiment: null,
      events: [],
      transcript: "",
      reports: [],
      logs: [],
      error: error instanceof Error ? error.message : "Unable to load admin data."
    };
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function SecretForm({
  action,
  children,
  className = "space-y-2"
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={action} className={className}>
      <input className="field" name="adminSecret" type="password" placeholder="ADMIN_SECRET" />
      {children}
    </form>
  );
}
