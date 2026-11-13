/**
 * OPRS row fill from the stored B-number operator name.
 * Each color lists the registry INNs whose current operator name paints that
 * color. A trimmed name that belongs to two colors is left unpainted.
 * The brand word in «Сеть» follows the color, not the legal name.
 */

import { CALL_STATUS } from "@/modules/traffic/call-class";
import { OPRS_FAILED_TAIL_COLUMN } from "@/modules/traffic/columns";

export const OPRS_OPERATOR_INNS = {
  green: ["7812014560", "7701725181"],
  red: ["7740000076"],
  yellow: ["7713076301", "9725152215"],
  gray: [
    "7743895280",
    "7707049388",
    "9705121882",
    "7727443720",
    "9722028932",
    "6163225548",
    "7451318173",
    "7727842771",
    "7709362765",
    "7727752084",
    "6670019135",
    "7721634013",
    "3808084952",
    "9710027740",
  ],
} as const;

export type OprsOperatorTone = keyof typeof OPRS_OPERATOR_INNS;

/** Not a table column. The screen paints from this stamp, not from a second lookup. */
export const OPRS_TONE_FIELD = "oprs_tone";

const TONE_SET = new Set<string>(["green", "red", "yellow", "gray"]);

export type OprsOperatorToneMap = Partial<Record<string, OprsOperatorTone>>;

export type OprsOperatorNameGroup = {
  tone: OprsOperatorTone;
  names: readonly string[];
  truncated: boolean;
};

/** Names from a truncated facet are dropped. A name on two tones is dropped. */
export function oprsToneMap(
  groups: readonly OprsOperatorNameGroup[],
): OprsOperatorToneMap {
  const found = new Map<string, OprsOperatorTone | "conflict">();
  for (const group of groups) {
    if (group.truncated) continue;
    for (const raw of group.names) {
      const name = raw.trim();
      if (!name) continue;
      const prev = found.get(name);
      if (prev == null) found.set(name, group.tone);
      else if (prev !== group.tone) found.set(name, "conflict");
    }
  }
  const map: OprsOperatorToneMap = {};
  for (const [name, tone] of found) {
    if (tone !== "conflict") map[name] = tone;
  }
  return map;
}

export type OprsToneConflict = {
  name: string;
  tones: OprsOperatorTone[];
};

/** The paint map, plus the tones and names the loader should warn about. */
export function oprsToneReport(groups: readonly OprsOperatorNameGroup[]): {
  map: OprsOperatorToneMap;
  truncated: OprsOperatorTone[];
  conflicts: OprsToneConflict[];
} {
  const seen = new Map<string, Set<OprsOperatorTone>>();
  for (const group of groups) {
    if (group.truncated) continue;
    for (const raw of group.names) {
      const name = raw.trim();
      if (!name) continue;
      const tones = seen.get(name) ?? new Set<OprsOperatorTone>();
      tones.add(group.tone);
      seen.set(name, tones);
    }
  }
  const conflicts: OprsToneConflict[] = [];
  for (const [name, tones] of seen) {
    if (tones.size > 1) conflicts.push({ name, tones: [...tones] });
  }
  return {
    map: oprsToneMap(groups),
    truncated: groups.filter((group) => group.truncated).map((group) => group.tone),
    conflicts,
  };
}

export function oprsStampedTone(value: string | undefined): OprsOperatorTone | null {
  if (value && TONE_SET.has(value)) return value as OprsOperatorTone;
  return null;
}

export function oprsOperatorTone(
  operator: string,
  map: OprsOperatorToneMap,
): OprsOperatorTone | null {
  const name = operator.trim();
  if (!name) return null;
  return map[name] ?? null;
}

/** True for «Секунды» and every column to its right when the call failed. */
export function oprsFailedTail(
  column: string,
  columns: readonly string[],
  status: string,
): boolean {
  if (status !== CALL_STATUS.failed) return false;
  const start = columns.indexOf(OPRS_FAILED_TAIL_COLUMN);
  if (start < 0) return false;
  const index = columns.indexOf(column);
  return index >= start;
}
