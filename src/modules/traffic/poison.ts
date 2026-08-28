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
