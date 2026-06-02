"use server";

import { revalidatePath } from "next/cache";
import {
  createExperiment,
  getLatestExperiment,
  setExperimentHour,
  updateExperimentStatus
} from "@/lib/experiment/db";
import { finalizeExperiment, runNextHour } from "@/lib/experiment/engine";
import { requireEnv } from "@/lib/env";

function assertAdmin(formData: FormData) {
  const secret = String(formData.get("adminSecret") ?? "");
  if (secret !== requireEnv("ADMIN_SECRET")) {
    throw new Error("Invalid admin secret.");
  }
}

export async function createExperimentAction(formData: FormData) {
  assertAdmin(formData);
  const title = String(formData.get("title") ?? "").trim();
  await createExperiment(title || undefined);
  revalidatePath("/admin");
}

export async function setStatusAction(formData: FormData) {
  assertAdmin(formData);
  const experiment = await getLatestExperiment();
  if (!experiment) return;

  const status = String(formData.get("status"));
  if (!["draft", "running", "paused"].includes(status)) {
    throw new Error("Unsupported status.");
  }

  await updateExperimentStatus(experiment.id, status as "draft" | "running" | "paused");
  revalidatePath("/admin");
}

export async function forceNextHourAction(formData: FormData) {
  assertAdmin(formData);
  await runNextHour();
  revalidatePath("/admin");
}

export async function setHourAction(formData: FormData) {
  assertAdmin(formData);
  const experiment = await getLatestExperiment();
  if (!experiment) return;

  const hour = Number(formData.get("hour"));
  if (!Number.isInteger(hour) || hour < 1 || hour > 73) {
    throw new Error("Hour must be between 1 and 73.");
  }

  await setExperimentHour(experiment.id, hour);
  revalidatePath("/admin");
}

export async function finalizeAction(formData: FormData) {
  assertAdmin(formData);
  const experiment = await getLatestExperiment();
  if (!experiment) return;

  await updateExperimentStatus(experiment.id, "finalizing");
  await finalizeExperiment(experiment.id);
  revalidatePath("/admin");
}
