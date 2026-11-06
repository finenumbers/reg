/**
 * One in-memory XLSX build per catalog. A second start waits. The file stays
 * for the owner to download again, and another user cannot take that slot
 * while the file is still fresh.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ColumnFilters } from "@/components/column-filters/types";
import type { NumberingFilters } from "@/modules/numbering-resource/filters";
import { isTableExportCancel } from "@/modules/table-export/pages";

export const TABLE_EXPORT_DIR_PREFIX = "reg-table-xlsx-";
const KEEP_MS = 15 * 60 * 1000;
const KEY = "__reg_table_xlsx_jobs__";

export type TableExportKind = "free" | "numbering";

export type TableExportRequest =
  | { kind: "free"; filters: ColumnFilters; phoneQ: string }
  | { kind: "numbering"; filters: NumberingFilters };

export type TableExportStatus = "running" | "completed" | "failed" | "cancelled";

export type TableExportJobView = {
  id: string;
  kind: TableExportKind;
  status: TableExportStatus;
  rowsWritten: number;
  totalRows: number | null;
  errorMessage: string | null;
  filename: string | null;
};

export type TableExportRunContext = {
  request: TableExportRequest;
  filePath: string;
  signal: AbortSignal;
  clientIp: string | null;
  setTotal: (total: number | null) => void;
  setWritten: (written: number) => void;
};

type Job = TableExportJobView & {
  actorUserId: string;
  dir: string | null;
  filePath: string | null;
  createdAt: number;
  finishedAt: number | null;
  abort: AbortController;
  clientIp: string | null;
  request: TableExportRequest;
};

type Store = { jobs: Record<TableExportKind, Job | null> };

function emptyStore(): Store {
  return { jobs: { free: null, numbering: null } };
}

function store(): Store {
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  if (!holder[KEY]) holder[KEY] = emptyStore();
  return holder[KEY];
}

export function resetTableExportJobsForTests(): void {
  const current = store();
  for (const kind of ["free", "numbering"] as const) {
    const job = current.jobs[kind];
    if (job) {
      job.abort.abort();
      if (job.dir) void rm(job.dir, { recursive: true, force: true });
    }
  }
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  holder[KEY] = emptyStore();
}

export function tableExportSlotHeld(
  job: {
    status: TableExportStatus;
    actorUserId: string;
    finishedAt: number | null;
  } | null,
  actorUserId: string,
  now: number,
): boolean {
  if (!job) return false;
  if (job.status === "running") return true;
  if (job.status !== "completed") return false;
  if (job.actorUserId === actorUserId) return false;
  if (typeof job.finishedAt !== "number") return false;
  return now - job.finishedAt < KEEP_MS;
}

function viewOf(job: Job): TableExportJobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    rowsWritten: job.rowsWritten,
    totalRows: job.totalRows,
    errorMessage: job.errorMessage,
    filename: job.filename,
  };
}

async function discardDir(job: Job): Promise<void> {
  if (!job.dir) return;
  const dir = job.dir;
  job.dir = null;
  job.filePath = null;
  await rm(dir, { recursive: true, force: true });
}

function userMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Не удалось сформировать XLSX";
}

export function beginTableExportJob(
  input: {
    actorUserId: string;
    clientIp: string | null;
    filename: string;
    request: TableExportRequest;
  },
  run: (ctx: TableExportRunContext) => Promise<void>,
): TableExportJobView | "busy" {
  const kind = input.request.kind;
  const current = store().jobs[kind];
  if (tableExportSlotHeld(current, input.actorUserId, Date.now())) return "busy";
  if (current) {
    current.abort.abort();
    void discardDir(current);
  }
  const job: Job = {
    id: randomUUID(),
    kind,
    actorUserId: input.actorUserId,
    status: "running",
    rowsWritten: 0,
    totalRows: null,
    errorMessage: null,
    filename: input.filename,
    dir: null,
    filePath: null,
    createdAt: Date.now(),
    finishedAt: null,
    abort: new AbortController(),
    clientIp: input.clientIp,
    request: input.request,
  };
  store().jobs[kind] = job;
  void runJob(job, run);
  return viewOf(job);
}

async function runJob(
  job: Job,
  run: (ctx: TableExportRunContext) => Promise<void>,
): Promise<void> {
  const kind = job.kind;
  try {
    const dir = await mkdtemp(path.join(tmpdir(), TABLE_EXPORT_DIR_PREFIX));
    if (store().jobs[kind] !== job || job.abort.signal.aborted) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    job.dir = dir;
    job.filePath = path.join(dir, "output.xlsx");
    await run({
      request: job.request,
      filePath: job.filePath,
      signal: job.abort.signal,
      clientIp: job.clientIp,
      setTotal: (total) => {
        if (store().jobs[kind] === job) job.totalRows = total;
      },
      setWritten: (written) => {
        if (store().jobs[kind] === job) job.rowsWritten = written;
      },
    });
    if (store().jobs[kind] !== job) {
      await discardDir(job);
      return;
    }
    if (job.abort.signal.aborted || job.status === "cancelled") {
      job.status = "cancelled";
      job.finishedAt = Date.now();
      await discardDir(job);
      return;
    }
    job.status = "completed";
    job.finishedAt = Date.now();
    const timer = setTimeout(() => {
      if (store().jobs[kind] !== job) return;
      store().jobs[kind] = null;
      void discardDir(job);
    }, KEEP_MS);
    timer.unref?.();
  } catch (error) {
    if (store().jobs[kind] !== job) {
      await discardDir(job);
      return;
    }
    const cancelled =
      job.status === "cancelled" || isTableExportCancel(error, job.abort.signal);
    job.status = cancelled ? "cancelled" : "failed";
    job.errorMessage = cancelled ? null : userMessage(error);
    job.finishedAt = Date.now();
    await discardDir(job);
  }
}

export function readTableExportJob(
  kind: TableExportKind,
  id: string,
  actorUserId: string,
): TableExportJobView | null {
  const job = store().jobs[kind];
  if (!job || job.id !== id || job.actorUserId !== actorUserId) return null;
  return viewOf(job);
}

export function readActiveTableExportJob(
  kind: TableExportKind,
  actorUserId: string,
): TableExportJobView | null {
  const job = store().jobs[kind];
  if (!job || job.actorUserId !== actorUserId) return null;
  if (
    job.status === "completed" &&
    job.finishedAt != null &&
    Date.now() - job.finishedAt >= KEEP_MS
  ) {
    return null;
  }
  return viewOf(job);
}

export function readTableExportFile(
  kind: TableExportKind,
  id: string,
  actorUserId: string,
): { filePath: string; filename: string } | null {
  const job = store().jobs[kind];
  if (
    !job ||
    job.id !== id ||
    job.actorUserId !== actorUserId ||
    job.status !== "completed" ||
    !job.filePath ||
    !job.filename
  ) {
    return null;
  }
  return { filePath: job.filePath, filename: job.filename };
}

export function cancelTableExportJob(
  kind: TableExportKind,
  id: string,
  actorUserId: string,
): "missing" | "cancelled" | "dismissed" {
  const job = store().jobs[kind];
  if (!job || job.id !== id || job.actorUserId !== actorUserId) return "missing";
  if (job.status === "running") {
    job.status = "cancelled";
    job.abort.abort();
    return "cancelled";
  }
  store().jobs[kind] = null;
  void discardDir(job);
  return "dismissed";
}

/** Startup drops files left by a process that no longer has the job. */
export async function pruneTableExportTemps(root = tmpdir()): Promise<number> {
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(TABLE_EXPORT_DIR_PREFIX)) continue;
    await rm(path.join(root, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
