/**
 * OPRS row fill from the stored B-number operator name.
 * The four INNs are the mobile operators. The name is whatever the numbering
 * registry currently stores for that INN. A trimmed name that belongs to two
 * of them is left unpainted.
 */

import { CALL_STATUS } from "@/modules/traffic/call-class";
import { OPRS_MARKING_COLUMN } from "@/modules/traffic/columns";

export const OPRS_OPERATOR_INNS = {
  green: "7812014560",
  red: "7740000076",
  yellow: "7713076301",
  gray: "7743895280",
} as const;

export type OprsOperatorTone = keyof typeof OPRS_OPERATOR_INNS;

export type OprsOperatorToneMap = Partial<Record<string, OprsOperatorTone>>;

export type OprsOperatorNameGroup = {
  tone: OprsOperatorTone;
  names: readonly string[];
  truncated: boolean;
};

/** Names from a truncated facet are dropped. A name on two tones is dropped. */
export function oprsToneMap(groups: readonly OprsOperatorNameGroup[]): OprsOperatorToneMap {
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

export function oprsOperatorTone(
  operator: string,
  map: OprsOperatorToneMap,
): OprsOperatorTone | null {
  const name = operator.trim();
  if (!name) return null;
  return map[name] ?? null;
}

/** True for «Маркировка» and every column to its right when the call failed. */
export function oprsFailedTail(
  column: string,
  columns: readonly string[],
  status: string,
): boolean {
  if (status !== CALL_STATUS.failed) return false;
  const start = columns.indexOf(OPRS_MARKING_COLUMN);
  if (start < 0) return false;
  const index = columns.indexOf(column);
  return index >= start;
}
