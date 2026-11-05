import { formatDisplayTimestamp } from "@/lib/format-display-time";

/** Last successful load, taken from one job_run. */
export type SyncSnapshot = {
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
};

export const EMPTY_SYNC: SyncSnapshot = {
  finishedAt: null,
  durationMs: null,
  summary: null,
};

/** Wall time, duration in whole seconds, and the job summary. */
export function formatSyncLine(snapshot: SyncSnapshot, timeZone: string): string {
  if (!snapshot.finishedAt) return "ещё не загружалось";
  const parts = [formatDisplayTimestamp(snapshot.finishedAt, timeZone)];
  const duration = snapshot.durationMs;
  if (duration != null && Number.isFinite(duration) && duration >= 0) {
    parts.push(`${Math.ceil(duration / 1000)} с`);
  }
  const summary = snapshot.summary?.trim() ?? "";
  if (summary) parts.push(summary);
  return parts.join(" · ");
}
