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
      period: "previous",
    });
    expect(getMonthExportForOwner(job.id, "user-b")).toBeNull();
    expect(getMonthExportForOwner(job.id, "user-a")?.id).toBe(job.id);
    expect(toJobView(job).downloadUrl).toBeNull();
  });
});
