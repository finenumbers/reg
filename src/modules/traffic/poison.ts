import { readFileSync, writeFileSync } from "node:fs";
import { poisonStorePath } from "@/modules/traffic/paths";

export type PoisonEntry = {
  mtimeMs: number;
  error: string;
};

type PoisonMap = Record<string, PoisonEntry>;

function readMap(cwd?: string): PoisonMap {
  try {
    const raw = readFileSync(poisonStorePath(cwd), "utf8");
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
  writeFileSync(poisonStorePath(cwd), `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

export function isPoisoned(
  filename: string,
  mtimeMs: number,
  cwd?: string,
): boolean {
  const entry = readMap(cwd)[filename];
  return Boolean(entry && entry.mtimeMs === mtimeMs);
}

export function markPoisoned(
  filename: string,
  mtimeMs: number,
  error: string,
  cwd?: string,
): void {
  const map = readMap(cwd);
  map[filename] = { mtimeMs, error };
  writeMap(map, cwd);
}

export function clearPoison(filename?: string, cwd?: string): void {
  if (!filename) {
    writeMap({}, cwd);
    return;
  }
  const map = readMap(cwd);
  delete map[filename];
  writeMap(map, cwd);
}

export const PURGE_HOLD_PREFIX = "Отложено: идёт удаление ";

export function purgeHoldMessage(month: string): string {
  return `${PURGE_HOLD_PREFIX}${month}`;
}

export function isPurgeHoldError(error: string): boolean {
  return error.startsWith(PURGE_HOLD_PREFIX);
}

export type InboxPoisonItem = {
  filename: string;
  error: string;
  heldForPurge: boolean;
};

export function listPoisonEntries(cwd?: string): InboxPoisonItem[] {
  const map = readMap(cwd);
  return Object.entries(map)
    .map(([filename, entry]) => ({
      filename,
      error: entry.error,
      heldForPurge: isPurgeHoldError(entry.error),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export function clearPurgeHolds(month: string, cwd?: string): number {
  const needle = purgeHoldMessage(month);
  const map = readMap(cwd);
  let removed = 0;
  for (const [filename, entry] of Object.entries(map)) {
    if (entry.error === needle || entry.error.startsWith(`${needle}`)) {
      delete map[filename];
      removed += 1;
    }
  }
  if (removed > 0) writeMap(map, cwd);
  return removed;
}
