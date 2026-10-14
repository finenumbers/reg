import { readFileSync, writeFileSync } from "node:fs";
import { poisonStorePath } from "@/modules/traffic/paths";
import { getPurgeTargetMonth } from "@/modules/traffic/purge/target";

export type PoisonEntry = {
  mtimeMs: number;
  error: string;
  /** Byte size observed when the file was held. Absent on older journal rows. */
  size?: number;
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
  size?: number,
): boolean {
  const entry = readMap(cwd)[filename];
  if (!entry || entry.mtimeMs !== mtimeMs) return false;
  if (size != null && typeof entry.size === "number" && entry.size !== size) {
    return false;
  }
  // A dump marked empty while STOR was still truncating it, then filled
  // without an mtime change. The bytes on disk are a new version.
  if (size != null && size > 0 && entry.error.startsWith("Файл пустой")) return false;
  if (purgeHoldReleased(entry.error)) return false;
  if (size == null) return true;
  if (typeof entry.size === "number") return entry.size === size;
  return true;
}

export function markPoisoned(
  filename: string,
  mtimeMs: number,
  error: string,
  cwd?: string,
  size?: number,
): void {
  const map = readMap(cwd);
  map[filename] = size == null ? { mtimeMs, error } : { mtimeMs, error, size };
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

const HOLD_MONTH = /Отложено: идёт удаление (\d{4}-\d{2})(?=$|[.)\s])/;

/** First `YYYY-MM` in a purge-hold sentence. The boundary keeps `2026-1` off `2026-10`. */
export function heldMonthInError(error: string): string | null {
  return HOLD_MONTH.exec(error)?.[1] ?? null;
}

/** True when `month` is a whole hold token, including inside a partial-load error. */
export function errorHoldsMonth(error: string, month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const needle = purgeHoldMessage(month);
  let from = 0;
  while (from < error.length) {
    const at = error.indexOf(needle, from);
    if (at < 0) return false;
    const next = error[at + needle.length];
    if (
      next === undefined ||
      next === "." ||
      next === ")" ||
      next === " " ||
      next === "\n" ||
      next === "\r"
    ) {
      return true;
    }
    from = at + needle.length;
  }
  return false;
}

/**
 * A hold for a month that is not the live purge target must not hide the file.
 * A parse error without the hold sentence stays poisoned.
 */
export function purgeHoldReleased(error: string): boolean {
  const month = heldMonthInError(error);
  if (!month) return false;
  return getPurgeTargetMonth() !== month;
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

function isHoldForMonth(error: string, month: string): boolean {
  return errorHoldsMonth(error, month);
}

export function clearPurgeHolds(month: string, cwd?: string): number {
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
export function clearAllPurgeHolds(cwd?: string): number {
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
export function clearPoisonExceptMonthHold(month: string | null, cwd?: string): void {
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
