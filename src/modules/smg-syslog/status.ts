import { mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { statusPath } from "@/modules/smg-syslog/paths";

export const LOW_SPACE_BYTES = 1024 * 1024 * 1024;

export type SyslogStatus = {
  enabled: boolean;
  listening: boolean;
  bindError: string | null;
  freeBytes: number | null;
  lowSpace: boolean;
  pendingRaw: number;
  unknownTotal: number;
  unknown: { ip: string; count: number }[];
  lastPacket: Record<string, string>;
  bridgeWarning: boolean;
  updatedAt: string;
};

export function emptyStatus(): SyslogStatus {
  return {
    enabled: false,
    listening: false,
    bindError: null,
    freeBytes: null,
    lowSpace: false,
    pendingRaw: 0,
    unknownTotal: 0,
    unknown: [],
    lastPacket: {},
    bridgeWarning: false,
    updatedAt: new Date(0).toISOString(),
  };
}

export function freeBytes(root: string): number | null {
  try {
    const stats = statfsSync(root);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function writeStatus(root: string, status: SyslogStatus): void {
  mkdirSync(root, { recursive: true });
  const target = statusPath(root);
  const tmp = path.join(root, ".status.json.tmp");
  const body = JSON.stringify({ ...status, updatedAt: new Date().toISOString() });
  writeFileSync(tmp, body, { mode: 0o640 });
  renameSync(tmp, target);
}

export function readStatus(root: string): SyslogStatus | null {
  try {
    const raw = readFileSync(statusPath(root), "utf8");
    const parsed = JSON.parse(raw) as Partial<SyslogStatus>;
    if (!parsed || typeof parsed !== "object") return null;
    return { ...emptyStatus(), ...parsed, unknown: parsed.unknown ?? [], lastPacket: parsed.lastPacket ?? {} };
  } catch {
    return null;
  }
}
