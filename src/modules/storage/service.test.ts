import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const jobFindFirst = vi.fn();
const queryMonthStatsWithMinutes = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    jobRun: {
      findFirst: (...args: unknown[]) => jobFindFirst(...args),
    },
  },
}));

vi.mock("@/modules/jobs/runtime", () => ({
  jobRuntime: {
    isInFlight: () => false,
  },
}));

vi.mock("@/modules/traffic/cdr-month-stats", () => ({
  queryMonthStatsWithMinutes: (...args: unknown[]) =>
    queryMonthStatsWithMinutes(...args),
}));

import { listStorageSnapshot } from "@/modules/storage/service";
import {
  resetDatabaseVacuumForTests,
  setDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";

describe("listStorageSnapshot during vacuum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDatabaseVacuumForTests();
    queryMonthStatsWithMinutes.mockRejectedValue(new Error("cdr_records was read"));
    queryRaw.mockRejectedValue(new Error("relation size was read"));
    jobFindFirst.mockResolvedValue({
      status: "running",
      errorMessage: null,
      meta: {
        phase: "cdr_records",
        tables: {
          cdr_voipmonitor_links: "done",
          cdr_records: "active",
        },
      },
    });
  });

  it("does not read cdr_records while the vacuum flag is set", async () => {
    setDatabaseVacuumActive(true);
    const snapshot = await listStorageSnapshot();
    expect(queryMonthStatsWithMinutes).not.toHaveBeenCalled();
    const texts = queryRaw.mock.calls.map((call) => {
      const sql = call[0];
      if (sql && typeof sql === "object" && "strings" in sql) {
        return ((sql as { strings?: string[] }).strings ?? []).join(" ");
      }
      return String(sql);
    });
    expect(texts.join("\n")).not.toMatch(/pg_total_relation_size/);
    expect(texts.join("\n")).not.toMatch(/FROM cdr_records/);
    expect(snapshot.monthsHidden).toBe(true);
    expect(snapshot.vacuumInFlight).toBe(true);
    expect(snapshot.vacuum?.stages.map((stage) => stage.state)).toEqual([
      "done",
      "active",
      "pending",
    ]);
  });
});
