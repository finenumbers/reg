import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  matchE164Sql,
  pstnHitLateral,
  pstnMissSql,
  PSTN_HIT_COLUMNS,
} from "@/modules/numbering-catalog/pstn-hit-sql";

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

describe("matchE164Sql", () => {
  it("builds 7+national from 7/8 eleven-digit and bare 10-digit forms", () => {
    const sql = flattenSql(matchE164Sql(Prisma.sql`s.number`));
    expect(sql).toContain("regexp_replace(s.number, '[^0-9]', '', 'g')");
    expect(sql).toContain("?");
    expect(sql).toContain("'7' || substring");
    expect(sql).toContain("'7' ||");
  });
});

describe("pstnHitLateral", () => {
  it("matches a covering range by the GiST span after matchE164", () => {
    const e164 = matchE164Sql(Prisma.sql`batch.e164`);
    const sql = flattenSql(pstnHitLateral(e164));
    expect(sql).toContain("pstn_range_snapshot");
    expect(sql).toContain("int4range(s.range_start, s.range_end, '[]') @>");
    expect(sql).toContain("digits.local_key IS NOT NULL");
    expect(sql).toContain("s.abc = digits.abc_key");
    expect(sql).toContain("from 5)::int");
    expect(sql).toContain("regexp_replace(batch.e164");
    expect(sql).not.toContain("BETWEEN");
  });

  it("caps hits above one as class 2 in PSTN_HIT_COLUMNS", () => {
    const sql = flattenSql(PSTN_HIT_COLUMNS);
    expect(sql).toContain("WHEN pstn.hits > 1 THEN 2");
    expect(sql).toContain("WHEN pstn.hits = 1 THEN 1");
  });
});

describe("pstnMissSql", () => {
  it("treats a missing key or non-single hit as a miss", () => {
    const e164 = matchE164Sql(Prisma.sql`s.number`);
    const sql = flattenSql(pstnMissSql(e164));
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("COALESCE(pstn.hits, 0) <> 1");
  });
});
