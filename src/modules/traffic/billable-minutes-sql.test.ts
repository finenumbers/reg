import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { monthStatsWithDurationSql } from "@/modules/traffic/cdr-month-stats";
import { billableMinutes } from "@/modules/enrich/types";
import { elapsedMsToSeconds } from "@/modules/traffic/month-export-types";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  const strings = sql.strings;
  const rawValues = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= rawValues.length) continue;
    const value = rawValues[i];
    if (value instanceof Prisma.Sql) {
      text.push(flattenSql(value));
    } else {
      text.push("?");
    }
  }
  return text.join("");
}

describe("month duration SQL", () => {
  it("sums per-call seconds and per-call minutes separately", () => {
    const text = flattenSql(monthStatsWithDurationSql());
    expect(text).toContain("::bigint AS seconds");
    expect(text).toContain("::bigint AS minutes");
    expect(text).toContain("SUM(");
    expect(text.split("CEIL(").length).toBeGreaterThan(2);
    expect(text).not.toMatch(/SUM\s*\([^)]+\)\s*\/\s*60/);
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
});
