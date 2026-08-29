/**
 * In-process month-export jobs. State on globalThis so App Router bundles share it.
 */

import { randomUUID } from "node:crypto";
import {
  failOpenMonthExportStages,
  INITIAL_MONTH_EXPORT_STAGES,
  isActiveMonthExport,
  type MonthExportJobStatus,
  type MonthExportJobView,
  type MonthExportStageId,
  type MonthExportStageView,
} from "@/modules/traffic/month-export-types";
import { removeMonthExportJobDir } from "@/modules/traffic/month-export-reclaim";

const KEY = "__reg_month_export_jobs__";

export type MonthExportJobRecord = MonthExportJobView & {
  actorUserId: string;
  createdAt: number;
};

type Store = {
  jobs: Map<string, MonthExportJobRecord>;
  running: boolean;
};

function store(): Store {
  const g = globalThis as typeof globalThis & { [KEY]?: Store };
  if (!g[KEY]) {
    g[KEY] = { jobs: new Map(), running: false };
  }
  return g[KEY];
}

/** Test helper */
export function resetMonthExportJobsForTests(): void {
  const s = store();
  s.jobs.clear();
  s.running = false;
}

export function isMonthExportRunning(): boolean {
  return store().running;
}

export function findActiveMonthExport(
  actorUserId: string,
): MonthExportJobView | null {
  for (const job of store().jobs.values()) {
    if (job.actorUserId === actorUserId && isActiveMonthExport(job)) {
      return toJobView(job);
    }
  }
  return null;
}

export function getMonthExportById(id: string): MonthExportJobRecord | null {
  return store().jobs.get(id) ?? null;
}

export function getMonthExportForOwner(
  id: string,
  actorUserId: string,
): MonthExportJobRecord | null {
  const job = store().jobs.get(id);
  if (!job || job.actorUserId !== actorUserId) return null;
  return job;
}

export function toJobView(job: MonthExportJobRecord): MonthExportJobView {
  return {
    id: job.id,
    status: job.status,
    month: job.month,
    title: job.title,
    trafficSheetName: job.trafficSheetName,
    filename: job.filename,
    stages: job.stages,
    errorMessage: job.errorMessage,
    downloadUrl:
      job.status === "completed" ? `/api/traffic/export/${job.id}/download` : null,
  };
}

export class MonthExportActiveConflictError extends Error {
  constructor() {
    super("Уже выполняется выгрузка трафика");
    this.name = "MonthExportActiveConflictError";
  }
}

export function createMonthExportJob(input: {
  actorUserId: string;
  month: string;
}): MonthExportJobRecord {
  const s = store();
  if (s.running) {
    throw new MonthExportActiveConflictError();
  }
  s.running = true;
  const id = randomUUID();
  const job: MonthExportJobRecord = {
    id,
    actorUserId: input.actorUserId,
    createdAt: Date.now(),
    status: "queued",
    month: input.month,
    title: "",
    trafficSheetName: "",
    filename: "",
    stages: INITIAL_MONTH_EXPORT_STAGES.map((stage) => ({ ...stage })),
    errorMessage: null,
    downloadUrl: null,
  };
  s.jobs.set(id, job);
  return job;
}

export function abortCreatedMonthExport(id: string): void {
  store().jobs.delete(id);
  store().running = false;
}

export function patchMonthExportJob(
  id: string,
  patch: Partial<
    Pick<
      MonthExportJobRecord,
      | "status"
      | "title"
      | "trafficSheetName"
      | "filename"
      | "stages"
      | "errorMessage"
    >
  >,
): void {
  const job = store().jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

export function setMonthExportStage(
  stages: MonthExportStageView[],
  id: MonthExportStageId,
  patch: Partial<MonthExportStageView>,
): MonthExportStageView[] {
  return stages.map((stage) =>
    stage.id === id ? { ...stage, ...patch, id: stage.id } : stage,
  );
}

export function startMonthExport(run: () => Promise<void>): void {
  void run().finally(() => {
    store().running = false;
  });
}

export async function dismissFinishedMonthExport(
  id: string,
  actorUserId: string,
): Promise<"ok" | "not_found" | "active"> {
  const job = getMonthExportForOwner(id, actorUserId);
  if (!job) return "not_found";
  if (isActiveMonthExport(job)) return "active";
  store().jobs.delete(id);
  await removeMonthExportJobDir(id);
  return "ok";
}

export function markMonthExportFailed(id: string, message: string): void {
  const job = store().jobs.get(id);
  if (!job) return;
  job.status = "failed" satisfies MonthExportJobStatus;
  job.errorMessage = message;
  job.stages = failOpenMonthExportStages(job.stages, message);
}
