import { readFileSync, writeFileSync } from "node:fs";
import { smgPoisonStorePath } from "@/modules/smg/paths";

export type SmgPoisonEntry = {
  mtimeMs: number;
  error: string;
};

type PoisonMap = Record<string, SmgPoisonEntry>;

function readMap(cwd?: string): PoisonMap {
  try {
    const raw = readFileSync(smgPoisonStorePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PoisonMap;
  } catch {
    return {};
  }
}

function writeMap(map: PoisonMap, cwd?: string): void {
  writeFileSync(
    smgPoisonStorePath(cwd),
    `${JSON.stringify(map, null, 2)}\n`,
    "utf8",
  );
}

export function isSmgPoisoned(
  filename: string,
  mtimeMs: number,
  cwd?: string,
): boolean {
  const entry = readMap(cwd)[filename];
  return Boolean(entry && entry.mtimeMs === mtimeMs);
}

export function markSmgPoisoned(
  filename: string,
  mtimeMs: number,
  error: string,
  cwd?: string,
): void {
  const map = readMap(cwd);
  map[filename] = { mtimeMs, error };
  writeMap(map, cwd);
}

export function clearSmgPoison(filename?: string, cwd?: string): void {
  if (!filename) {
    writeMap({}, cwd);
    return;
  }
  const map = readMap(cwd);
  delete map[filename];
  writeMap(map, cwd);
}

export type SmgPoisonItem = {
  filename: string;
  error: string;
};

export function listSmgPoisonEntries(cwd?: string): SmgPoisonItem[] {
  const map = readMap(cwd);
  return Object.entries(map)
    .map(([filename, entry]) => ({
      filename,
      error: entry.error,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
