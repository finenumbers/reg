import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  SMG_CDR_NAME_RE,
  SMG_FILE_SETTLE_MS,
  SMG_MAX_FILE_BYTES,
} from "@/modules/smg/columns";
import { smgInboxRoot, SMG_POISON_FILENAME } from "@/modules/smg/paths";
import { isSmgPoisoned, listSmgPoisonEntries } from "@/modules/smg/poison";
import { isStorBusy } from "@/modules/traffic/stor-gate";

export type SmgInboxFile = {
  filename: string;
  absPath: string;
  size: number;
  mtimeMs: number;
};

export function isSmgCdrFilename(name: string): boolean {
  return SMG_CDR_NAME_RE.test(name);
}

export function isHiddenInboxName(name: string): boolean {
  return !name || name.startsWith(".") || name === SMG_POISON_FILENAME;
}

export function smgInboxFileError(file: SmgInboxFile): string | null {
  if (file.size <= 0) return `Файл пустой: ${file.filename}`;
  if (file.size > SMG_MAX_FILE_BYTES) {
    return `Файл слишком большой (${file.size} байт, лимит ${SMG_MAX_FILE_BYTES}): ${file.filename}`;
  }
  return null;
}

export async function listSmgInboxFiles(
  opts: { cwd?: string; now?: number } = {},
): Promise<{ ready: SmgInboxFile[]; young: SmgInboxFile[] }> {
  const root = smgInboxRoot(opts.cwd);
  const now = opts.now ?? Date.now();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return { ready: [], young: [] };
  }

  const ready: SmgInboxFile[] = [];
  const young: SmgInboxFile[] = [];
  for (const filename of names.sort()) {
    if (isHiddenInboxName(filename)) continue;
    const absPath = path.join(root, filename);
    let st;
    try {
      st = await stat(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const file: SmgInboxFile = {
      filename,
      absPath,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
    if (isStorBusy(absPath, now) || now - st.mtimeMs < SMG_FILE_SETTLE_MS) {
      young.push(file);
      continue;
    }
    if (isSmgPoisoned(filename, st.mtimeMs, opts.cwd, st.size)) continue;
    ready.push(file);
  }
  return { ready, young };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function openPoisonedSmgFile(
  filename: string,
  cwd?: string,
): Promise<SmgInboxFile | null> {
  if (isHiddenInboxName(filename)) return null;
  if (!listSmgPoisonEntries(cwd).some((entry) => entry.filename === filename)) {
    return null;
  }

  const root = smgInboxRoot(cwd);
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
    return {
      filename,
      absPath: fileReal,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
  } catch {
    return null;
  }
}
