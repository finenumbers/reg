import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  PARKING_DST,
  SIP_TRUNK_PREFIXES,
  STATS_DEVICE_PREFIXES,
} from "@/modules/stats/classify";
import { deviceMonthStatsSql } from "@/modules/stats/sql";

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

describe("deviceMonthStatsSql", () => {
  it("filters the month with cdr_day LIKE and bind prefix", () => {
    const { text, values } = flattenSql(deviceMonthStatsSql(2026, 8));
    expect(text).toContain("cdr_day LIKE");
    expect(text).not.toContain("left(cdr_day");
    expect(values).toContain("2026-08-%");
  });

  it("uses starts_with for prefixes, not unescaped LIKE", () => {
    const { text, values } = flattenSql(deviceMonthStatsSql(2026, 8));
    expect(text).toContain("starts_with");
    expect(text).not.toMatch(/LIKE 'PSTN_%'/);
    expect(text).not.toMatch(/LIKE 'Trunk_%'/);
    for (const prefix of STATS_DEVICE_PREFIXES) {
      expect(values).toContain(prefix);
    }
    for (const prefix of SIP_TRUNK_PREFIXES) {
      expect(values).toContain(prefix);
    }
  });

  it("bills minutes with nested CEIL, not SUM(seconds)/60", () => {
    const { text } = flattenSql(deviceMonthStatsSql(2026, 8));
    expect(text).toContain("CEIL(");
    expect(text.split("CEIL(").length).toBeGreaterThan(2);
    expect(text).not.toMatch(/SUM\s*\([^)]+\)\s*\/\s*60/);
  });

  it("counts parking and phantom only on the inbound SIP leg", () => {
    const { text, values } = flattenSql(deviceMonthStatsSql(2026, 8));
    expect(values).toContain(PARKING_DST);
    expect(values).toContain(MISSING_BILLING_LABEL);
    expect(text).toContain("side_a");
    expect(text).toContain("side_b");
    expect(text).toContain("parking_calls");
    expect(text).toContain("phantom_calls");
    expect(text).toMatch(/0 AS parking/);
    expect(text).toMatch(/0 AS phantom/);
  });
});
