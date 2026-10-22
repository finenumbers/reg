import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ColumnFilters } from "@/components/column-filters/types";
import { smgDeviceFileLabel, writeSmgExport } from "@/modules/smg/service";
import {
  smgExportFilename,
  SmgExportTooLargeError,
  type SmgExportLayout,
} from "@/modules/smg/xlsx-export";
import type { CdrMonth } from "@/modules/traffic/cdr-month";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

const KEY = "__reg_smg_xlsx_job__";
const KEEP_MS = 15 * 60 * 1000;

export type SmgExportJobView = {
  id: string;
  status: "running" | "ready" | "error";
  error: string | null;
};

type Job = SmgExportJobView & {
  dir: string | null;
  filePath: string | null;
  filename: string;
  createdAt: number;
};

type Store = { job: Job | null };

function store(): Store {
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  if (!holder[KEY]) holder[KEY] = { job: null };
  return holder[KEY];
}

export function readSmgExportJob(id: string): SmgExportJobView | null {
  const job = store().job;
  if (!job || job.id !== id) return null;
  return { id: job.id, status: job.status, error: job.error };
}

/** One build at a time. A finished file is dropped when the next build starts. */
export function beginSmgExportJob(input: {
  month: CdrMonth;
  device: string;
  phoneQ: string;
  filters: ColumnFilters;
  setupSort?: TimeSort | null;
  layout: SmgExportLayout;
}): SmgExportJobView | "busy" {
  const current = store().job;
  if (current?.status === "running") return "busy";
  if (current) void discardJob(current);
  const job: Job = {
    id: randomUUID(),
    status: "running",
    error: null,
    dir: null,
    filePath: null,
    filename: smgExportFilename(input.layout, input.month.key, input.device),
    createdAt: Date.now(),
  };
  store().job = job;
  void runSmgExportJob(job, input);
  return { id: job.id, status: job.status, error: job.error };
}

export function takeSmgExportFile(
  id: string,
): { filePath: string; filename: string; dir: string } | null {
  const job = store().job;
  if (!job || job.id !== id || job.status !== "ready" || !job.filePath || !job.dir) {
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

async function runSmgExportJob(
  job: Job,
  input: {
    month: CdrMonth;
    device: string;
    phoneQ: string;
    filters: ColumnFilters;
    setupSort?: TimeSort | null;
    layout: SmgExportLayout;
  },
): Promise<void> {
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "smg-xlsx-"));
    if (store().job !== job) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    job.dir = dir;
    job.filePath = path.join(dir, "output.xlsx");
    job.filename = smgExportFilename(
      input.layout,
      input.month.key,
      await smgDeviceFileLabel(input.device),
    );
    await writeSmgExport({ ...input, filePath: job.filePath });
    if (store().job !== job) {
      await discardJob(job);
      return;
    }
    job.status = "ready";
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
        error instanceof SmgExportTooLargeError
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
