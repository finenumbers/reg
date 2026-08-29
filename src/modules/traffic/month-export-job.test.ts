import { afterEach, describe, expect, it } from "vitest";
import {
  createMonthExportJob,
  getMonthExportForOwner,
  resetMonthExportJobsForTests,
  toJobView,
} from "@/modules/traffic/month-export-job";

afterEach(() => {
  resetMonthExportJobsForTests();
});

describe("month export job registry", () => {
  it("does not hand another user's job", () => {
    const job = createMonthExportJob({
      actorUserId: "user-a",
      month: "2026-07",
    });
    expect(getMonthExportForOwner(job.id, "user-b")).toBeNull();
    expect(getMonthExportForOwner(job.id, "user-a")?.id).toBe(job.id);
    expect(toJobView(job).downloadUrl).toBeNull();
    expect(toJobView(job).includeDetail).toBe(false);
    expect(job.stages.some((stage) => stage.id === "detail")).toBe(false);
  });

  it("keeps the detail stage only for extended export", () => {
    const job = createMonthExportJob({
      actorUserId: "user-a",
      month: "2026-07",
      includeDetail: true,
    });
    expect(job.includeDetail).toBe(true);
    expect(job.stages.some((stage) => stage.id === "detail")).toBe(true);
  });
});
