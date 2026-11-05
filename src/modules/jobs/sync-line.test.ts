import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
import { EMPTY_SYNC, formatSyncLine } from "@/modules/jobs/sync-line";
import { syncSnapshotFromJob } from "@/modules/jobs/sync-snapshot";
import type { JobRunListItem } from "@/modules/jobs/query";

function job(over: Partial<JobRunListItem> = {}): JobRunListItem {
  return {
    id: "job",
    actionCode: "regs.poll",
    trigger: "schedule",
    status: "success",
    startedAt: "2026-11-06T02:30:56.000Z",
    finishedAt: "2026-11-06T02:31:04.000Z",
    durationMs: 7500,
    errorMessage: null,
    exitCode: null,
    phonesParsed: 1240,
    linesBad: 0,
    changesCount: 3,
    actorUserId: null,
    actorUsername: null,
    hasArtifact: false,
    meta: null,
    ...over,
  };
}

describe("formatSyncLine", () => {
  it("names a missing load", () => {
    expect(formatSyncLine(EMPTY_SYNC, "UTC")).toBe("ещё не загружалось");
  });

  it("joins the finish time, whole seconds, and the summary", () => {
    expect(
      formatSyncLine(
        {
          finishedAt: "2026-11-06T02:31:04.000Z",
          durationMs: 7500,
          summary: `${formatCount(1240)} номеров · 3 изменения`,
        },
        "UTC",
      ),
    ).toBe(`06.11.2026, 02:31:04 · 8 с · ${formatCount(1240)} номеров · 3 изменения`);
  });

  it("omits a missing duration", () => {
    expect(
      formatSyncLine(
        { finishedAt: "2026-11-06T02:31:04.000Z", durationMs: null, summary: "48 групп" },
        "UTC",
      ),
    ).toBe("06.11.2026, 02:31:04 · 48 групп");
  });
});

describe("syncSnapshotFromJob", () => {
  it("takes time, duration, and summary from the successful run", () => {
    expect(syncSnapshotFromJob(job())).toEqual({
      finishedAt: "2026-11-06T02:31:04.000Z",
      durationMs: 7500,
      summary: `${formatCount(1240)} номеров · ${formatCount(3)} изменений`,
    });
  });

  it("ignores a failed run", () => {
    expect(syncSnapshotFromJob(job({ status: "failed", errorMessage: "timeout" }))).toEqual(
      EMPTY_SYNC,
    );
  });
});
