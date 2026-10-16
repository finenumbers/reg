import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { concurrencyMinutesSql, errorMinutesSql, errorScanStart } from "./call-query";
import { utcCallWindow } from "./concurrency";
import { parseDashboardSeries } from "./series";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

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

const afternoon = utcCallWindow(new Date("2026-10-16T14:22:30.000Z"));

describe("parseDashboardSeries", () => {
  it("defaults a missing value to phone and rejects anything else", () => {
    expect(parseDashboardSeries(null)).toBe("phone");
    expect(parseDashboardSeries("")).toBe("phone");
    expect(parseDashboardSeries("client")).toBe("client");
    expect(parseDashboardSeries("errors")).toBe("errors");
    expect(parseDashboardSeries("phone ")).toBeNull();
    expect(parseDashboardSeries("smg")).toBeNull();
  });
});

describe("concurrencyMinutesSql", () => {
  it("leaves the phone sweep without a stored class filter", () => {
    const sql = flattenSql(concurrencyMinutesSql(afternoon, "phone"));
    expect(sql.text).not.toContain("call_category");
    expect(sql.text).not.toContain("call_status");
    expect(sql.text).not.toContain("call_type");
    expect(sql.text).toContain("elapsed_time");
    expect(sql.text).toContain("WHERE ms > 0");
  });

  it("keeps client traffic on category and status, including a successful redirect", () => {
    const sql = flattenSql(concurrencyMinutesSql(afternoon, "client"));
    expect(sql.text).not.toContain("call_type");
    expect(sql.text).toContain("call_category =");
    expect(sql.text).toContain("call_status =");
    expect(sql.values).toEqual([
      afternoon.scanStart,
      afternoon.dayEnd,
      CALL_CATEGORY.incoming,
      CALL_STATUS.success,
      CALL_CATEGORY.outgoing,
      CALL_STATUS.success,
      afternoon.seriesEnd,
      afternoon.dayStart,
      afternoon.recentStart,
      afternoon.dayStart,
      afternoon.recentStart,
    ]);
  });

  it("filters phantom and both parking directions by the stored labels", () => {
    expect(flattenSql(concurrencyMinutesSql(afternoon, "phantom")).values).toContain(
      CALL_CATEGORY.phantom,
    );
    const incoming = flattenSql(concurrencyMinutesSql(afternoon, "parking-in"));
    expect(incoming.values).toContain(CALL_CATEGORY.incoming);
    expect(incoming.values).toContain(CALL_STATUS.parking);
    const outgoing = flattenSql(concurrencyMinutesSql(afternoon, "parking-out"));
    expect(outgoing.values).toContain(CALL_CATEGORY.outgoing);
    expect(outgoing.values).toContain(CALL_STATUS.parking);
    expect(incoming.text).not.toContain("call_type");
  });
});

describe("errorMinutesSql", () => {
  it("counts error rows in the minute of cdrAt and does not expand duration", () => {
    const sql = flattenSql(errorMinutesSql(afternoon));
    expect(sql.text).toContain("count(*) FILTER");
    expect(sql.text).toContain("call_category =");
    expect(sql.text).not.toContain("elapsed_time");
    expect(sql.text).not.toContain("call_status");
    expect(sql.values).toContain(CALL_CATEGORY.errors);
    expect(sql.values).toContain(afternoon.dayStart);
    expect(sql.values).toContain(afternoon.seriesEnd);
  });

  it("reaches into the previous evening only for the two-hour window", () => {
    const early = utcCallWindow(new Date("2026-10-16T00:10:00.000Z"));
    expect(errorScanStart(early).toISOString()).toBe(early.recentStart.toISOString());
    expect(errorScanStart(afternoon).toISOString()).toBe(
      afternoon.dayStart.toISOString(),
    );
    const sql = flattenSql(errorMinutesSql(early));
    expect(sql.values[2]).toEqual(early.recentStart);
  });
});
