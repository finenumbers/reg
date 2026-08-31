import { describe, expect, it } from "vitest";
import {
  buildJobsListUrl,
  formatDurationMs,
  formatJobTrigger,
  jobStatusBadgeVariant,
  summarizeJobResult,
} from "@/modules/jobs/ui-format";
import type { JobRunListItem } from "@/modules/jobs/query";

function sample(overrides: Partial<JobRunListItem> = {}): JobRunListItem {
  return {
    id: "j1",
    actionCode: "regs.poll",
    trigger: "manual",
    status: "success",
    startedAt: "2026-08-06T10:00:00.000Z",
    finishedAt: "2026-08-06T10:00:02.000Z",
    durationMs: 2000,
    errorMessage: null,
    exitCode: 0,
    phonesParsed: 12,
    linesBad: 1,
    changesCount: 3,
    actorUserId: "u1",
    actorUsername: "ops",
    hasArtifact: true,
    ...overrides,
  };
}

describe("jobs ui-format", () => {
  it("formats duration and trigger", () => {
    expect(formatDurationMs(250)).toBe("1");
    expect(formatDurationMs(1500)).toBe("2");
    expect(formatDurationMs(65000)).toBe("65");
    expect(formatDurationMs(null)).toBe("—");
    expect(formatJobTrigger("schedule")).toBe("По расписанию");
  });

  it("summarizes success and failure", () => {
    expect(summarizeJobResult(sample())).toContain("12 номеров");
    expect(summarizeJobResult(sample())).toContain("есть артефакт");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "groups.sync",
          phonesParsed: 5,
          linesBad: 0,
          changesCount: 5,
        }),
      ),
    ).toContain("5 групп");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.import",
          phonesParsed: 8,
          linesBad: 0,
          changesCount: 1,
        }),
      ),
    ).toContain("8 записей");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.sides.refresh",
          phonesParsed: 3,
          linesBad: 0,
          changesCount: 12,
        }),
      ),
    ).toContain("3 номеров в diff");
    expect(
      summarizeJobResult(
        sample({ status: "failed", errorMessage: "SSH timeout" }),
      ),
    ).toBe("SSH timeout");
    expect(summarizeJobResult(sample({ status: "running" }))).toBe(
      "Выполняется…",
    );
  });

  it("maps status badge variants", () => {
    expect(jobStatusBadgeVariant("success")).toBe("default");
    expect(jobStatusBadgeVariant("failed")).toBe("destructive");
    expect(jobStatusBadgeVariant("running")).toBe("outline");
  });

  it("builds list URLs with filters", () => {
    expect(buildJobsListUrl()).toBe("/api/jobs");
    expect(buildJobsListUrl({ status: "failed", page: 2 })).toBe(
      "/api/jobs?status=failed&page=2",
    );
  });
});
