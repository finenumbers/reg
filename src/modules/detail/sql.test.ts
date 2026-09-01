import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  DETAIL_LDC_SUFFIX,
  DETAIL_LOCAL_SUFFIX,
  DETAIL_OLD_SUFFIX,
  DETAIL_PSTN_PREFIX,
  DETAIL_TRUNK_PREFIX,
  PARKING_DST,
} from "@/modules/detail/classify";
import { clientMonthStatsSql } from "@/modules/detail/sql";

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

describe("clientMonthStatsSql", () => {
  it("materializes catalog and month CTEs and trims phones before DISTINCT ON", () => {
    const { text } = flattenSql(clientMonthStatsSql(2026, 8));
    expect(text).toContain("AS MATERIALIZED");
    expect(text).toContain("DISTINCT ON (phone)");
    expect(text).toContain('TRIM("endpointNumber")');
    expect(text).toContain("TRIM(bill_ani)");
    expect(text).toContain("TRIM(bill_dnis)");
    expect(text).toContain("Описание");
  });

  it("filters the month with cdr_day LIKE and bind prefix", () => {
    const { text, values } = flattenSql(clientMonthStatsSql(2026, 8));
    expect(text).toContain("cdr_day LIKE");
    expect(values).toContain("2026-08-%");
  });

  it("uses starts_with for prefixes, not unescaped LIKE", () => {
    const { text, values } = flattenSql(clientMonthStatsSql(2026, 8));
    expect(text).toContain("starts_with");
    expect(text).not.toMatch(/LIKE 'PSTN_%'/);
    expect(text).not.toMatch(/LIKE 'Trunk_%'/);
    expect(values).toContain(DETAIL_PSTN_PREFIX);
    expect(values).toContain(DETAIL_TRUNK_PREFIX);
    expect(values).toContain(DETAIL_LOCAL_SUFFIX);
    expect(values).toContain(DETAIL_LDC_SUFFIX);
    expect(values).toContain(DETAIL_OLD_SUFFIX);
    expect(values).toContain(PARKING_DST);
  });

  it("bills minutes with nested CEIL, not SUM(seconds)/60", () => {
    const { text } = flattenSql(clientMonthStatsSql(2026, 8));
    expect(text).toContain("CEIL(");
    expect(text.split("CEIL(").length).toBeGreaterThan(2);
    expect(text).not.toMatch(/SUM\s*\([^)]+\)\s*\/\s*60/);
  });
});
