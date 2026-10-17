import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
const queryRaw = vi.fn();
const transaction = vi.fn(
  async (
    fn: (tx: { $executeRaw: typeof executeRaw; $queryRaw: typeof queryRaw }) => Promise<unknown>,
    _opts?: unknown,
  ) => fn({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
);
const vacuum = vi.fn(() => false);

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
}));

vi.mock("@/modules/smg/month-stats", () => ({
  querySmgMonthStats: vi.fn(),
}));

import {
  ANTIFRAUD_SENT_PATTERN,
  antifraudEventsSql,
  dashboardAntifraudEvents,
  resetDashboardCardFiguresForTests,
} from "@/modules/dashboard/card-figures";

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

describe("antifraudEventsSql", () => {
  it("keeps the sent-line pattern and asks Postgres for a case-insensitive match", () => {
    const { text, values } = flattenSql(antifraudEventsSql());
    expect(values).toContain(ANTIFRAUD_SENT_PATTERN);
    expect(text).toContain("'gi'");
    expect(text).not.toContain("\\b");
    expect(ANTIFRAUD_SENT_PATTERN).toBe(
      "Request ID\\s*\\[\\d+\\]\\s+(?:is sent|send)(?:[^A-Za-z]|$)",
    );
  });
});

describe("dashboardAntifraudEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vacuum.mockReturnValue(false);
    queryRaw.mockResolvedValue([{ n: 4 }]);
    executeRaw.mockResolvedValue(0);
    resetDashboardCardFiguresForTests();
  });

  it("limits the statement to 8 seconds inside the transaction and caches the count", async () => {
    await expect(dashboardAntifraudEvents()).resolves.toBe(4);
    await expect(dashboardAntifraudEvents()).resolves.toBe(4);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[1]).toEqual({ maxWait: 5_000, timeout: 12_000 });
    const timeoutSql = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(timeoutSql[0].join("")).toContain("set_config('statement_timeout'");
    expect(timeoutSql[0].join("")).toContain("true");
    expect(timeoutSql[1]).toBe("8s");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("caches a real zero", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    await expect(dashboardAntifraudEvents()).resolves.toBe(0);
    await expect(dashboardAntifraudEvents()).resolves.toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    queryRaw.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));
    await expect(dashboardAntifraudEvents()).resolves.toBeNull();
    queryRaw.mockResolvedValue([{ n: 3 }]);
    await expect(dashboardAntifraudEvents()).resolves.toBe(3);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not cache a count that finished after vacuum started", async () => {
    queryRaw.mockImplementation(async () => {
      vacuum.mockReturnValue(true);
      return [{ n: 5 }];
    });
    await expect(dashboardAntifraudEvents()).resolves.toBeNull();
    vacuum.mockReturnValue(false);
    queryRaw.mockResolvedValue([{ n: 5 }]);
    await expect(dashboardAntifraudEvents()).resolves.toBe(5);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not read while the database is being compressed", async () => {
    vacuum.mockReturnValue(true);
    await expect(dashboardAntifraudEvents()).resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("shares one read between two callers", async () => {
    let release: (rows: { n: number }[]) => void = () => {};
    queryRaw.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = dashboardAntifraudEvents();
    const second = dashboardAntifraudEvents();
    expect(transaction).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    release([{ n: 9 }]);
    await expect(first).resolves.toBe(9);
    await expect(second).resolves.toBe(9);
  });
});
