import type { JobRunListItem } from "@/modules/jobs/query";
import { EMPTY_SYNC, type SyncSnapshot } from "@/modules/jobs/sync-line";
import { summarizeJobResult } from "@/modules/jobs/ui-format";

/** Time, duration, and summary from the same successful run. */
export function syncSnapshotFromJob(job: JobRunListItem | null): SyncSnapshot {
  if (!job || job.status !== "success") return EMPTY_SYNC;
  return {
    finishedAt: job.finishedAt ?? job.startedAt,
    durationMs: job.durationMs,
    summary: summarizeJobResult(job),
  };
}
