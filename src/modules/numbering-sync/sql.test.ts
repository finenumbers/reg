import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/numbering-sync/reclaim";
import {
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  decidePublish,
  fillSplitSql,
  recomputeSql,
} from "@/modules/numbering-sync/sql";

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
  it("fills the draft with the RTU tariff functions and copies without them", () => {
    const split = flattenSql(fillSplitSql("run", 2000));
    expect(split).toContain("cdr_tariff_geo");
    expect(split).toContain("geography_digit_split");
    expect(split).toContain("starts_with");
    expect(split).toContain("numbering_sync_stage");
    expect(split).not.toContain("INSERT INTO free_numbers");

    expect(FREE_COPY_SQL).toContain("INSERT INTO free_numbers");
    expect(FREE_COPY_SQL).toContain("ready = true");
    expect(FREE_COPY_SQL).not.toContain("cdr_tariff_geo");
    expect(FREE_COPY_SQL).not.toContain("geography_digit_split");
    expect(PURCHASED_COPY_SQL).toContain("INSERT INTO purchased_numbers");
    expect(PURCHASED_COPY_SQL).not.toContain("cdr_tariff_geo");
  });

  it("rolls back when the inserted count does not match the draft", () => {
    expect(
      decidePublish({
        held: true,
        stagedFree: 2,
        insertedFree: 2,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("commit");
    expect(
      decidePublish({
        held: true,
        stagedFree: 2,
        insertedFree: 1,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("rollback");
    expect(
      decidePublish({
        held: false,
        stagedFree: 0,
        insertedFree: 0,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("rollback");
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

  it("drops the lease and the draft without touching the catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
    expect(RECLAIM_STAGE_SQL).toContain("DELETE FROM numbering_sync_stage");
    expect(RECLAIM_STATE_SQL).toContain("phase IN ('running', 'publishing')");
  });
});
