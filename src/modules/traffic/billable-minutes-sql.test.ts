import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { monthStatsWithDurationSql } from "@/modules/traffic/cdr-month-stats";
import { MINUTE_GRACE_SECONDS, billableMinutes } from "@/modules/enrich/types";
import { billableMinutesSql } from "@/modules/traffic/billable-minutes-sql";
import { elapsedMsToSeconds } from "@/modules/traffic/month-export-types";

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

describe("month duration SQL", () => {
  it("sums per-call seconds and per-call minutes separately", () => {
    const { text } = flattenSql(monthStatsWithDurationSql());
    expect(text).toContain("::bigint AS seconds");
    expect(text).toContain("::bigint AS minutes");
    expect(text).toContain("SUM(");
    expect(text.split("CEIL(").length).toBeGreaterThan(2);
    expect(text).not.toMatch(/SUM\s*\([^)]+\)\s*\/\s*60/);
  });

  it("binds the three-second grace before ceiling minutes", () => {
    const { text, values } = flattenSql(billableMinutesSql());
    expect(text).toContain("CASE");
    expect(text).toContain("<=");
    expect(values).toContain(MINUTE_GRACE_SECONDS);
    expect(text.split("CEIL(").length).toBeGreaterThan(2);
  });
});

describe("billable duration helpers", () => {
  it("turns 126109 ms into 127 seconds and 3 minutes", () => {
    expect(elapsedMsToSeconds("126109")).toBe(127);
    expect(billableMinutes(127)).toBe(3);
  });

  it("treats blank duration as 0 minutes", () => {
    expect(billableMinutes(elapsedMsToSeconds(""))).toBe(0);
    expect(billableMinutes(elapsedMsToSeconds("abc"))).toBe(0);
  });

  it("keeps one to three seconds at zero minutes and rounds from the fourth", () => {
    expect(billableMinutes(elapsedMsToSeconds("1000"))).toBe(0);
    expect(billableMinutes(elapsedMsToSeconds("3000"))).toBe(0);
    expect(billableMinutes(elapsedMsToSeconds("3001"))).toBe(1);
    expect(billableMinutes(elapsedMsToSeconds("61000"))).toBe(2);
  });
});
