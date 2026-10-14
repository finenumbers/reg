import { readFileSync, writeFileSync } from "node:fs";
import { smgPoisonStorePath } from "@/modules/smg/paths";
import { isPurgeHoldError, purgeHoldMessage } from "@/modules/traffic/poison";

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

function isHoldForMonth(error: string, month: string): boolean {
  const needle = purgeHoldMessage(month);
  return error === needle || error.startsWith(needle);
}

export function clearSmgPurgeHolds(month: string, cwd?: string): number {
  const map = readMap(cwd);
  let removed = 0;
  for (const [filename, entry] of Object.entries(map)) {
    if (isHoldForMonth(entry.error, month)) {
      delete map[filename];
      removed += 1;
    }
  }
  if (removed > 0) writeMap(map, cwd);
  return removed;
}

/** Drop every purge hold. Real parse-failure poison stays. */
export function clearAllSmgPurgeHolds(cwd?: string): number {
  const map = readMap(cwd);
  let removed = 0;
  for (const [filename, entry] of Object.entries(map)) {
    if (isPurgeHoldError(entry.error)) {
      delete map[filename];
      removed += 1;
    }
  }
  if (removed > 0) writeMap(map, cwd);
  return removed;
}

/**
 * Manual retry. While `month` is the live purge target, keep holds for that
 * month. A null month clears the whole journal, including stale holds.
 */
export function clearSmgPoisonExceptMonthHold(
  month: string | null,
  cwd?: string,
): void {
  if (!month) {
    writeMap({}, cwd);
    return;
  }
  const map = readMap(cwd);
  for (const [filename, entry] of Object.entries(map)) {
    if (isHoldForMonth(entry.error, month)) continue;
    delete map[filename];
  }
  writeMap(map, cwd);
}

export function listSmgPoisonEntries(cwd?: string): SmgPoisonItem[] {
  const map = readMap(cwd);
  return Object.entries(map)
    .map(([filename, entry]) => ({
      filename,
      error: entry.error,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
