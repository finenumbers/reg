/**
 * One in-process OPRS export. Same single-slot lifetime as the SMG export.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ColumnFilters } from "@/components/column-filters/types";
import type { CdrMonth } from "@/modules/traffic/cdr-month";
import type { TrafficRowFlags } from "@/modules/traffic/row-flags";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { writeOprsExport } from "@/modules/oprs/export-run";
import { OprsExportTooLargeError, oprsExportFilename } from "@/modules/oprs/xlsx-export";

const KEY = "__reg_oprs_xlsx_job__";
const KEEP_MS = 15 * 60 * 1000;

export type OprsExportJobView = {
  id: string;
  status: "running" | "ready" | "error";
  error: string | null;
};

type Job = OprsExportJobView & {
  actorUserId: string;
  dir: string | null;
  filePath: string | null;
  filename: string;
  createdAt: number;
  readyAt: number | null;
};

type Store = { job: Job | null };

function store(): Store {
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  if (!holder[KEY]) holder[KEY] = { job: null };
  return holder[KEY];
}

export function oprsExportSlotHeld(
  job: {
    status: Job["status"];
    actorUserId: string;
    createdAt: number;
    readyAt?: number | null;
  } | null,
  actorUserId: string,
  now: number,
): boolean {
  if (!job) return false;
  if (job.status === "running") return true;
  if (job.status !== "ready") return false;
  if (job.actorUserId === actorUserId) return false;
  if (typeof job.readyAt !== "number") return false;
  return now - job.readyAt < KEEP_MS;
}

export function readOprsExportJob(
  id: string,
  actorUserId: string,
): OprsExportJobView | null {
  const job = store().job;
  if (!job || job.id !== id || job.actorUserId !== actorUserId) return null;
  return { id: job.id, status: job.status, error: job.error };
}

export type OprsExportRequest = {
  month: CdrMonth;
  phoneQ: string;
  filters: ColumnFilters;
  flags: TrafficRowFlags;
  timeSort: TimeSort | null;
  snapshot: Date;
  actorUserId: string;
};

export function beginOprsExportJob(
  input: OprsExportRequest,
): OprsExportJobView | "busy" {
  const current = store().job;
  if (oprsExportSlotHeld(current, input.actorUserId, Date.now())) return "busy";
  if (current) void discardJob(current);
  const job: Job = {
    id: randomUUID(),
    actorUserId: input.actorUserId,
    status: "running",
    error: null,
    dir: null,
    filePath: null,
    filename: oprsExportFilename(input.month.key),
    createdAt: Date.now(),
    readyAt: null,
  };
  store().job = job;
  void runOprsExportJob(job, input);
  return { id: job.id, status: job.status, error: job.error };
}

export function takeOprsExportFile(
  id: string,
  actorUserId: string,
): { filePath: string; filename: string; dir: string } | null {
  const job = store().job;
  if (
    !job ||
    job.id !== id ||
    job.actorUserId !== actorUserId ||
    job.status !== "ready" ||
    !job.filePath ||
    !job.dir
  ) {
    return null;
  }
  const taken = { filePath: job.filePath, filename: job.filename, dir: job.dir };
  store().job = null;
  return taken;
}

async function discardJob(job: Job): Promise<void> {
  if (!job.dir) return;
  await rm(job.dir, { recursive: true, force: true });
}

async function runOprsExportJob(job: Job, input: OprsExportRequest): Promise<void> {
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "oprs-xlsx-"));
    if (store().job !== job) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    job.dir = dir;
    job.filePath = path.join(dir, "output.xlsx");
    job.filename = oprsExportFilename(input.month.key);
    await writeOprsExport({ ...input, filePath: job.filePath });
    if (store().job !== job) {
      await discardJob(job);
      return;
    }
    job.status = "ready";
    job.readyAt = Date.now();
    const timer = setTimeout(() => {
      if (store().job !== job) return;
      store().job = null;
      void discardJob(job);
    }, KEEP_MS);
    timer.unref?.();
  } catch (error) {
    if (store().job === job) {
      job.status = "error";
      job.error =
        error instanceof OprsExportTooLargeError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Не удалось сформировать XLSX";
    }
    await discardJob(job);
    job.dir = null;
    job.filePath = null;
  }
}
