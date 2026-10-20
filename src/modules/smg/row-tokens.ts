import { splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";

/** Stored day of «Дата». Empty when the cell is empty. */
export function setupDayToken(setupTime: string): string {
  return splitCdrDateParts(setupTime).day;
}

/** One «Переадресация» value. A blank outgoing number does not hide the incoming one. */
export function redirectToken(outgoing: string, incoming: string): string {
  const out = outgoing.trim();
  if (out) return out;
  return incoming.trim();
}

export type StoredTraceHit = {
  id: string;
  category: string | null;
  status: string | null;
};

export type ResolvedTraceLabel =
  | { kind: "none" }
  | { kind: "pending"; traceId: string }
  | { kind: "ready"; category: string; status: string };

export const NO_TRACE_LABELS = {
  category: AF_CATEGORY.noData,
  status: AF_STATUS.unknown,
} as const;

/**
 * Same choice as the call list. Two hits of one card count once.
 * Two cards are «Разбор не сошёлся», and their stored labels are not used.
 * A card with no stored label is classified from its text by the caller.
 */
export function resolveStoredTraces(rows: readonly StoredTraceHit[]): ResolvedTraceLabel {
  const byId = new Map<string, StoredTraceHit>();
  for (const row of rows) byId.set(row.id, row);
  const traces = [...byId.values()];
  if (traces.length === 0) return { kind: "none" };
  if (traces.length > 1) {
    return {
      kind: "ready",
      category: AF_CATEGORY.conflict,
      status: AF_STATUS.unknown,
    };
  }
  const trace = traces[0]!;
  if (!trace.category || !trace.status) return { kind: "pending", traceId: trace.id };
  return { kind: "ready", category: trace.category, status: trace.status };
}
