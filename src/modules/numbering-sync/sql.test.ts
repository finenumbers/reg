import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { publishInsertSql, recomputeSql } from "@/modules/numbering-sync/sql";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  const strings = sql.strings;
  const values = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= values.length) continue;
    const value = values[i];
    text.push(value instanceof Prisma.Sql ? flattenSql(value) : "?");
  }
  return text.join("");
}

describe("sipout publish sql", () => {
  it("splits with the RTU tariff functions and keeps one digit per source", () => {
    const free = flattenSql(publishInsertSql("free", "run"));
    expect(free).toContain("cdr_tariff_geo");
    expect(free).toContain("geography_digit_split");
    expect(free).toContain("starts_with");
    expect(free).toContain("SELECT DISTINCT e164");
    expect(free).toContain("INSERT INTO free_numbers");
    expect(free).not.toContain("purchased_numbers");

    const purchased = flattenSql(publishInsertSql("purchased", "run"));
    expect(purchased).toContain("INSERT INTO purchased_numbers");
    expect(purchased).toContain("geography_digit_split");
    expect(purchased).toContain("starts_with");
  });

  it("recomputes both catalogs from the stored digits", () => {
    const free = flattenSql(recomputeSql("free_numbers"));
    const purchased = flattenSql(recomputeSql("purchased_numbers"));
    expect(free).toContain("UPDATE free_numbers");
    expect(free).toContain("cdr_tariff_geo");
    expect(free).toContain("geography_digit_split");
    expect(purchased).toContain("UPDATE purchased_numbers");
    expect(purchased).not.toContain("free_numbers");
  });
});
