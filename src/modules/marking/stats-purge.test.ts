import { beforeEach, describe, expect, it, vi } from "vitest";
import { markingStatsFailureClearsRows } from "@/modules/marking/stats-hold";
import {
  getPurgeTargetMonth,
  PURGE_MONTH_BUSY_MESSAGE,
  resetPurgeTargetForTests,
  setPurgeTargetMonth,
} from "@/modules/traffic/purge/target";

const listCachedMonthCounts = vi.fn();
const cdrDataGeneration = vi.fn(() => 4);
const readRtuScreenGate = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/modules/storage/vacuum/gate", () => ({
  isDatabaseVacuumActive: () => false,
  CDR_VACUUM_BUSY_MESSAGE: "vacuum",
}));

vi.mock("@/modules/traffic/cdr-month-stats", () => ({
  listCachedMonthCounts: () => listCachedMonthCounts(),
  cdrDataGeneration: () => cdrDataGeneration(),
}));

vi.mock("@/modules/phones/blocked-numbers", () => ({
  requireBlockedNumberIndex: async () => ({
    stamp: "b",
    index: { exact: new Set<string>(), pstn: new Set<string>() },
  }),
}));

vi.mock("@/modules/oprs/operator-tone-load", () => ({
  loadOprsToneReport: async () => ({
    map: { Альфа: "red" },
    labelUnpainted: true,
  }),
}));

vi.mock("@/modules/rtu/screen-publish", () => ({
  readRtuScreenGate: () => readRtuScreenGate(),
  requestRtuScreenPublish: () => undefined,
}));

vi.mock("@/modules/oprs/timeout", () => ({
  withOprsTimeout: async (
    run: (tx: { $queryRaw: (sql: unknown) => Promise<unknown> }) => Promise<unknown>,
  ) => run({ $queryRaw: (sql) => queryRaw(sql) }),
}));

import { MarkingStatsError } from "@/modules/marking/stats";
import {
  forgetMarkingStatsMonth,
  listMarkingStats,
  markingStatsMonthOnRecord,
  resetMarkingStatsForTests,
} from "@/modules/marking/stats";

const NOW = new Date("2026-11-13T00:00:00.000Z");
const AUGUST = { year: 2026, month: 8, key: "2026-08" };
const NOVEMBER = { year: 2026, month: 11, key: "2026-11" };

function countedRow() {
  return {
    client: "А",
    numbers: 2,
    mts: 4,
    megafon: 0,
    beeline: 0,
    t2: 0,
    external: 1,
    catalog_revision: 3,
    loaded_at: null,
  };
}

function sqlValues(sql: unknown): unknown[] {
  if (!sql || typeof sql !== "object" || !("values" in sql)) return [];
  const values = (sql as { values?: unknown[] }).values ?? [];
  const out: unknown[] = [];
  for (const value of values) {
    if (
      value &&
      typeof value === "object" &&
      "values" in value &&
      "strings" in value
    ) {
      out.push(...sqlValues(value));
    } else {
      out.push(value);
    }
  }
  return out;
}

describe("marking stats during a month purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPurgeTargetForTests();
    resetMarkingStatsForTests();
    cdrDataGeneration.mockReturnValue(4);
    readRtuScreenGate.mockResolvedValue({
      published: true,
      needsPublish: false,
      catalogRevision: 3,
    });
    listCachedMonthCounts.mockResolvedValue([NOVEMBER, AUGUST]);
    queryRaw.mockResolvedValue([countedRow()]);
  });

  it("does not read or serve a cached month while that month is held", async () => {
    const first = await listMarkingStats("2026-08", NOW);
    expect(first.rows[0]?.mts).toBe(4);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    const cached = await listMarkingStats("2026-08", NOW);
    expect(cached.rows[0]?.mts).toBe(4);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    setPurgeTargetMonth("2026-08");
    await expect(listMarkingStats("2026-08", NOW)).rejects.toMatchObject({
      name: "MarkingStatsError",
      status: 503,
      message: PURGE_MONTH_BUSY_MESSAGE,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(getPurgeTargetMonth()).toBe("2026-08");
  });

  it("does not hand a running aggregate to a later reader of the held month", async () => {
    let release: (rows: unknown[]) => void = () => {};
    let opened = false;
    queryRaw.mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!opened) opened = true;
          release = resolve;
        }),
    );

    const first = listMarkingStats("2026-08", NOW);
    await vi.waitFor(() => {
      expect(opened).toBe(true);
    });
    setPurgeTargetMonth("2026-08");
    await expect(listMarkingStats("2026-08", NOW)).rejects.toBeInstanceOf(
      MarkingStatsError,
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);

    release([countedRow()]);
    const snapshot = await first;
    expect(snapshot.rows[0]?.mts).toBe(4);

    setPurgeTargetMonth(null);
    queryRaw.mockResolvedValue([countedRow()]);
    await listMarkingStats("2026-08", NOW);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("drops the stored month and reads it again", async () => {
    await listMarkingStats("2026-08", NOW);
    forgetMarkingStatsMonth("2026-08");
    await listMarkingStats("2026-08", NOW);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("answers a missing month from the current month and does not list it", async () => {
    listCachedMonthCounts.mockResolvedValue([NOVEMBER]);
    const snapshot = await listMarkingStats("2026-08", NOW);
    expect(snapshot.month).toBe("2026-11");
    expect(snapshot.months.map((item) => item.key)).toEqual(["2026-11"]);
    expect(sqlValues(queryRaw.mock.calls[0]?.[0])).toContain("2026-11-01");
    expect(sqlValues(queryRaw.mock.calls[0]?.[0])).not.toContain("2026-08-01");
    expect(
      markingStatsMonthOnRecord(AUGUST, [NOVEMBER], NOW).key,
    ).toBe("2026-11");
  });

  it("does not scan a month that disappeared before the aggregate", async () => {
    listCachedMonthCounts
      .mockResolvedValueOnce([NOVEMBER, AUGUST])
      .mockResolvedValueOnce([NOVEMBER]);
    const snapshot = await listMarkingStats("2026-08", NOW);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(snapshot.month).toBe("2026-11");
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.months.map((item) => item.key)).not.toContain("2026-08");
  });

  it("clears the open table only for the purge answer", () => {
    expect(markingStatsFailureClearsRows(PURGE_MONTH_BUSY_MESSAGE)).toBe(true);
    expect(markingStatsFailureClearsRows("Некорректный месяц")).toBe(false);
  });
});
