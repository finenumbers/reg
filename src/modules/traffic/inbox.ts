import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { CDR_MAX_FILE_BYTES } from "@/modules/traffic/columns";
import { cdrInboxRoot, POISON_FILENAME } from "@/modules/traffic/paths";
import { isPoisoned, listPoisonEntries } from "@/modules/traffic/poison";
import {
  CDR_STOR_SETTLE_MS,
  isStorBusy,
  storCompletedSize,
} from "@/modules/traffic/stor-gate";

export type InboxFile = {
  filename: string;
  absPath: string;
  size: number;
  mtimeMs: number;
};

/** Softswitch dump names: 20260827_200419 — no extension. */
const CDR_DUMP_FILENAME_RE = /^\d{8}_\d{6}$/;

export function isInboxDataFile(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  if (name === POISON_FILENAME) return false;
  return CDR_DUMP_FILENAME_RE.test(name);
}

function isYoungDump(
  absPath: string,
  size: number,
  mtimeMs: number,
  now: number,
): boolean {
  if (isStorBusy(absPath, now)) return true;
  if (storCompletedSize(absPath) === size) return false;
  return now - mtimeMs < CDR_STOR_SETTLE_MS;
}

export async function partitionInboxFiles(
  opts: { includePoisoned?: boolean; cwd?: string; now?: number } = {},
): Promise<{ ready: InboxFile[]; young: InboxFile[] }> {
  const root = cdrInboxRoot(opts.cwd);
  const now = opts.now ?? Date.now();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return { ready: [], young: [] };
  }

  const ready: InboxFile[] = [];
  const young: InboxFile[] = [];
  for (const filename of names.sort()) {
    if (!isInboxDataFile(filename)) continue;
    const absPath = path.join(root, filename);
    let st;
    try {
      st = await stat(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!opts.includePoisoned && isPoisoned(filename, st.mtimeMs, opts.cwd, st.size)) {
      continue;
    }
    const file: InboxFile = {
      filename,
      absPath,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
    if (isYoungDump(absPath, st.size, st.mtimeMs, now)) young.push(file);
    else ready.push(file);
  }
  return { ready, young };
}

export async function listInboxFiles(
  opts: { includePoisoned?: boolean; cwd?: string; now?: number } = {},
): Promise<InboxFile[]> {
  const { ready } = await partitionInboxFiles(opts);
  return ready;
}

export async function countInboxFiles(
  cwd?: string,
): Promise<{ pending: number; poisoned: number }> {
  const { ready, young } = await partitionInboxFiles({
    includePoisoned: true,
    cwd,
  });
  let pending = 0;
  let poisoned = 0;
  for (const file of ready) {
    if (isPoisoned(file.filename, file.mtimeMs, cwd, file.size)) poisoned += 1;
    else pending += 1;
  }
  for (const file of young) {
    if (isPoisoned(file.filename, file.mtimeMs, cwd, file.size)) poisoned += 1;
  }
  return { pending, poisoned };
}

export type PoisonedInboxFile = {
  filename: string;
  absPath: string;
  size: number;
};

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Current bytes of a dump the import journal has already held back.
 * A waiting inbox file and a path that leaves the inbox are not opened.
 * mtime is not compared: the journal name is what the error block shows.
 */
export async function openPoisonedInboxFile(
  filename: string,
  cwd?: string,
): Promise<PoisonedInboxFile | null> {
  if (!isInboxDataFile(filename)) return null;
  const held = listPoisonEntries(cwd).some((entry) => entry.filename === filename);
  if (!held) return null;

  const root = cdrInboxRoot(cwd);
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return null;
  }

  const joined = path.resolve(rootReal, filename);
  if (!isInsideRoot(rootReal, joined)) return null;

  try {
    const fileReal = await realpath(joined);
    if (!isInsideRoot(rootReal, fileReal)) return null;
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) return null;
    return { filename, absPath: fileReal, size: fileStat.size };
  } catch {
    return null;
  }
}

export function inboxFileError(file: InboxFile): string | null {
  if (file.size <= 0) return `Файл пустой: ${file.filename}`;
  if (file.size > CDR_MAX_FILE_BYTES) {
    return `Файл слишком большой (${file.size} байт, лимит ${CDR_MAX_FILE_BYTES}): ${file.filename}`;
  }
  return null;
}
