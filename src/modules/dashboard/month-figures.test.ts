import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MONTH_CALLS_UNAVAILABLE } from "@/modules/dashboard/month-prefix";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";

const executeRaw = vi.fn();
const queryRaw = vi.fn();
const transaction = vi.fn(
  async (
    fn: (tx: {
      $executeRaw: typeof executeRaw;
      $queryRaw: typeof queryRaw;
    }) => Promise<unknown>,
    opts?: unknown,
  ) => {
    if (opts == null) throw new Error("missing transaction options");
    return fn({ $executeRaw: executeRaw, $queryRaw: queryRaw });
  },
);
const vacuum = vi.fn(() => false);
const vacuumJob = vi.fn(() => false);

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (
      fn: (tx: {
        $executeRaw: typeof executeRaw;
        $queryRaw: typeof queryRaw;
      }) => Promise<unknown>,
      opts?: unknown,
    ) => transaction(fn, opts),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/modules/storage/vacuum/gate", () => ({
  isDatabaseVacuumActive: () => vacuum(),
  CDR_VACUUM_BUSY_MESSAGE: "Идёт сжатие базы. Повторите, когда оно закончится.",
}));

vi.mock("@/modules/jobs/runtime", () => ({
  jobRuntime: {
    isInFlight: (code: string) => code === "db.vacuum" && vacuumJob(),
  },
}));

import {
  dashboardCdrMonthSql,
  dashboardSmgMonthSql,
  readDashboardCdrCalls,
  readDashboardSmgMonth,
  resetDashboardMonthFiguresForTests,
} from "@/modules/dashboard/month-figures";
import { monthPrefixBounds } from "@/modules/dashboard/month-prefix";

const NOV = Date.UTC(2026, 10, 4, 12, 0, 0);
const DEC = Date.UTC(2026, 11, 4, 12, 0, 0);

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  const strings = sql.strings;
  const rawValues = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= rawValues.length) continue;
    const value = rawValues[i];
    if (value instanceof Prisma.Sql) {
      const inner = flattenSql(value);
      text.push(inner.text);
      values.push(...inner.values);
    } else {
      text.push("?");
      values.push(value);
    }
  }
  return { text: text.join(""), values };
}

describe("dashboard month sql", () => {
  it("counts the current month by day prefix, including a day of 00", () => {
    const november = flattenSql(
      dashboardCdrMonthSql(monthPrefixBounds({ year: 2026, month: 11, key: "2026-11" })),
    );
    expect(november.values).toEqual(["2026-11", "2026-12"]);
    expect(november.text).toContain("cdr_day >= ");
    expect(november.text).toContain("cdr_day < ");
    expect(november.text).toContain("COUNT(*)::bigint");
    expect(november.text).not.toContain("left(");
    expect(november.text).not.toContain("-01");

    const december = flattenSql(
      dashboardCdrMonthSql(monthPrefixBounds({ year: 2026, month: 12, key: "2026-12" })),
    );
    expect(december.values).toEqual(["2026-12", "2027-01"]);
    expect(december.text).not.toContain("-01");
  });

  it("sums SMG minutes with the shared billable expression and the same prefix", () => {
    const sql = flattenSql(
      dashboardSmgMonthSql(monthPrefixBounds({ year: 2026, month: 11, key: "2026-11" })),
    );
    expect(sql.values).toContain("2026-11");
    expect(sql.values).toContain("2026-12");
    expect(sql.text).toContain("disconnect_day >= ");
    expect(sql.text).toContain("disconnect_day < ");
    expect(sql.text).toContain("COUNT(*)::bigint");
    expect(sql.text).toContain("::bigint");
    expect(sql.text).not.toContain("left(");
    expect(sql.text).not.toContain("-01");
  });
});

describe("readDashboardCdrCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vacuum.mockReturnValue(false);
    vacuumJob.mockReturnValue(false);
    executeRaw.mockResolvedValue(0);
    queryRaw.mockReset();
    resetDashboardMonthFiguresForTests();
  });

  it("limits the statement to 8 seconds inside the transaction", async () => {
    queryRaw.mockResolvedValue([{ calls: BigInt(4) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 4, note: null });
    expect(transaction.mock.calls[0]?.[1]).toEqual({ maxWait: 5_000, timeout: 12_000 });
    const timeoutSql = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(timeoutSql[0].join("")).toContain("set_config('statement_timeout'");
    expect(timeoutSql[0].join("")).toContain("true");
    expect(timeoutSql[1]).toBe("8s");
  });

  it("does not hand November's count to December", async () => {
    queryRaw.mockResolvedValueOnce([{ calls: BigInt(11) }]);
    queryRaw.mockResolvedValueOnce([{ calls: BigInt(12) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 11, note: null });
    await expect(readDashboardCdrCalls(DEC)).resolves.toEqual({ calls: 12, note: null });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 11, note: null });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("caches an explicit zero", async () => {
    queryRaw.mockResolvedValue([{ calls: BigInt(0) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 0, note: null });
    await expect(readDashboardCdrCalls(NOV + 1_000)).resolves.toEqual({
      calls: 0,
      note: null,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not cache an unsafe count as zero", async () => {
    queryRaw.mockResolvedValue([{ calls: BigInt(2) ** BigInt(53) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({
      calls: null,
      note: MONTH_CALLS_UNAVAILABLE,
    });
    await expect(readDashboardCdrCalls(NOV + 1_000)).resolves.toEqual({
      calls: null,
      note: MONTH_CALLS_UNAVAILABLE,
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not query during vacuum and does not invent zero", async () => {
    vacuum.mockReturnValue(true);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({
      calls: null,
      note: CDR_VACUUM_BUSY_MESSAGE,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not query while the vacuum job is in flight", async () => {
    vacuumJob.mockReturnValue(true);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({
      calls: null,
      note: CDR_VACUUM_BUSY_MESSAGE,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("shows a stored count during vacuum even after the minute has passed", async () => {
    queryRaw.mockResolvedValue([{ calls: BigInt(7) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 7, note: null });
    vacuum.mockReturnValue(true);
    await expect(readDashboardCdrCalls(NOV + 70_000)).resolves.toEqual({
      calls: 7,
      note: null,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not store a count that finished after vacuum started", async () => {
    queryRaw.mockImplementation(async () => {
      vacuum.mockReturnValue(true);
      return [{ calls: BigInt(5) }];
    });
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({
      calls: null,
      note: CDR_VACUUM_BUSY_MESSAGE,
    });
    vacuum.mockReturnValue(false);
    queryRaw.mockResolvedValue([{ calls: BigInt(6) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 6, note: null });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("drops an expired count after a failed refresh and never writes zero", async () => {
    queryRaw.mockResolvedValueOnce([{ calls: BigInt(5) }]);
    await expect(readDashboardCdrCalls(NOV)).resolves.toEqual({ calls: 5, note: null });
    queryRaw.mockRejectedValueOnce(
      new Error("canceling statement due to statement timeout"),
    );
    await expect(readDashboardCdrCalls(NOV + 70_000)).resolves.toEqual({
      calls: null,
      note: MONTH_CALLS_UNAVAILABLE,
    });
    queryRaw.mockResolvedValueOnce([{ calls: BigInt(9) }]);
    await expect(readDashboardCdrCalls(NOV + 71_000)).resolves.toEqual({
      calls: 9,
      note: null,
    });
  });

  it("shares one read between two callers of the same month", async () => {
    let release: (rows: { calls: bigint }[]) => void = () => {};
    queryRaw.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = readDashboardCdrCalls(NOV);
    const second = readDashboardCdrCalls(NOV);
    await Promise.resolve();
    await Promise.resolve();
    expect(transaction).toHaveBeenCalledTimes(1);
    release([{ calls: BigInt(4) }]);
    await expect(first).resolves.toEqual({ calls: 4, note: null });
    await expect(second).resolves.toEqual({ calls: 4, note: null });
  });
});

describe("readDashboardSmgMonth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vacuum.mockReturnValue(false);
    vacuumJob.mockReturnValue(false);
    executeRaw.mockResolvedValue(0);
    queryRaw.mockReset();
    resetDashboardMonthFiguresForTests();
  });

  it("does not turn an empty vacuum skip into zero", async () => {
    vacuum.mockReturnValue(true);
    await expect(readDashboardSmgMonth(NOV)).resolves.toEqual({
      calls: null,
      minutes: null,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps calls when minutes do not parse", async () => {
    queryRaw.mockResolvedValue([{ calls: BigInt(5), minutes: "nope" }]);
    await expect(readDashboardSmgMonth(NOV)).resolves.toEqual({
      calls: 5,
      minutes: null,
    });
    await expect(readDashboardSmgMonth(NOV + 1_000)).resolves.toEqual({
      calls: 5,
      minutes: null,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not cache a row whose calls and minutes both fail to parse", async () => {
    queryRaw.mockResolvedValueOnce([{ calls: null, minutes: 1.5 }]);
    await expect(readDashboardSmgMonth(NOV)).resolves.toEqual({
      calls: null,
      minutes: null,
    });
    queryRaw.mockResolvedValueOnce([{ calls: BigInt(2), minutes: BigInt(3) }]);
    await expect(readDashboardSmgMonth(NOV + 1_000)).resolves.toEqual({
      calls: 2,
      minutes: 3,
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
