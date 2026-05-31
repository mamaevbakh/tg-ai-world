"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { startExperiment } from "@/lib/experiments/service";
import { addGalyaAgent } from "@/lib/world/agents";
import { createWorldEventOnce } from "@/lib/world/events";
import { runTick } from "@/lib/world/tick-engine";
import { ensureDefaultWorld, loadWorldBundle } from "@/lib/world/state";

async function getRequiredBundle() {
  const bundle = await loadWorldBundle();
  if (!bundle) {
    throw new Error("No world exists yet.");
  }
  return bundle;
}

export async function createWorldFromDashboard() {
  await ensureDefaultWorld("dashboard");
  revalidatePath("/");
}

export async function setWorldStatus(formData: FormData) {
  const bundle = await getRequiredBundle();
  const status = String(formData.get("status") ?? "");
  if (!["active", "paused"].includes(status)) {
    throw new Error("Unsupported world status.");
  }

  await sql`
    update worlds
    set status = ${status}, updated_at = now()
    where id = ${bundle.world.id}
  `;
  revalidatePath("/");
}

export async function runDashboardTick() {
  await runTick({ forced: true, sendTelegram: false });
  revalidatePath("/");
}

export async function addGalyaFromDashboard() {
  const bundle = await getRequiredBundle();
  await addGalyaAgent(bundle.world.id);
  revalidatePath("/");
}

export async function injectDashboardEvent(formData: FormData) {
  const bundle = await getRequiredBundle();
  const content = String(formData.get("content") ?? "").trim();
  const severity = Number(formData.get("severity") ?? 1);
  if (!content) return;

  await createWorldEventOnce({
    worldId: bundle.world.id,
    eventType: "game_master_event",
    title: null,
    content,
    severity: Number.isInteger(severity) ? Math.max(1, Math.min(5, severity)) : 1,
    source: "dashboard"
  });
  revalidatePath("/");
}

export async function startDashboardExperiment(formData: FormData) {
  const bundle = await getRequiredBundle();
  const slug = String(formData.get("slug") ?? "").trim();
  const durationRaw = String(formData.get("duration") ?? "").trim();
  const duration = durationRaw ? Number(durationRaw) : undefined;
  if (!slug) return;

  await startExperiment({
    worldId: bundle.world.id,
    agentId: bundle.agent.id,
    slug,
    startedTick: bundle.world.tick_count,
    durationTicks: Number.isInteger(duration) ? duration : undefined
  });
  revalidatePath("/");
}
