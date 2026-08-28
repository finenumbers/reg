import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CDR_MAX_FILE_BYTES } from "@/modules/traffic/columns";
import { cdrInboxRoot, POISON_FILENAME } from "@/modules/traffic/paths";
import { isPoisoned } from "@/modules/traffic/poison";

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

export async function listInboxFiles(
  opts: { includePoisoned?: boolean; cwd?: string } = {},
): Promise<InboxFile[]> {
  const root = cdrInboxRoot(opts.cwd);
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: InboxFile[] = [];
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
    if (!opts.includePoisoned && isPoisoned(filename, st.mtimeMs, opts.cwd)) {
      continue;
    }
    out.push({
      filename,
      absPath,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  return out;
}

export async function countInboxFiles(
  cwd?: string,
): Promise<{ pending: number; poisoned: number }> {
  const all = await listInboxFiles({ includePoisoned: true, cwd });
  let pending = 0;
  let poisoned = 0;
  for (const file of all) {
    if (isPoisoned(file.filename, file.mtimeMs, cwd)) poisoned += 1;
    else pending += 1;
  }
  return { pending, poisoned };
}

export function inboxFileError(file: InboxFile): string | null {
  if (file.size <= 0) return `Файл пустой: ${file.filename}`;
  if (file.size > CDR_MAX_FILE_BYTES) {
    return `Файл слишком большой (${file.size} байт, лимит ${CDR_MAX_FILE_BYTES}): ${file.filename}`;
  }
  return null;
}
