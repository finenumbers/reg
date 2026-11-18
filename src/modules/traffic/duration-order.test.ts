import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  compareDurationRows,
  durationKeysetSql,
  durationOrderSql,
  durationRowFollowsCursor,
  elapsedMsSortSql,
  parseElapsedSortKey,
} from "@/modules/traffic/billable-minutes-sql";

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    if (i >= sql.values.length) continue;
    const value = sql.values[i];
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

describe("elapsed sort key", () => {
  it("keeps a decimal and rejects a blank or a word", () => {
    expect(parseElapsedSortKey("999")).toBe("999");
    expect(parseElapsedSortKey("1,5")).toBe("1.5");
    expect(parseElapsedSortKey("")).toBeNull();
    expect(parseElapsedSortKey("abc")).toBeNull();
    expect(parseElapsedSortKey("1e3")).toBeNull();
  });

  it("leaves a non-numeric cell NULL instead of zero", () => {
    const { text } = flattenSql(elapsedMsSortSql());
    expect(text).toContain("::numeric");
    expect(text).not.toContain("ELSE 0");
  });
});

describe("duration order", () => {
  it("sorts 999 ms before 1000 ms when ascending and puts blanks last", () => {
    const rows = [
      { elapsed: "1000", cdrId: "b" },
      { elapsed: "", cdrId: "a" },
      { elapsed: "999", cdrId: "c" },
      { elapsed: "999", cdrId: "a" },
      { elapsed: "nope", cdrId: "b" },
    ];
    const asc = [...rows].sort((left, right) => compareDurationRows(left, right, "asc"));
    expect(asc.map((row) => `${row.elapsed}:${row.cdrId}`)).toEqual([
      "999:a",
      "999:c",
      "1000:b",
      ":a",
      "nope:b",
    ]);
    const desc = [...rows].sort((left, right) => compareDurationRows(left, right, "desc"));
    expect(desc.map((row) => `${row.elapsed}:${row.cdrId}`)).toEqual([
      "1000:b",
      "999:c",
      "999:a",
      "nope:b",
      ":a",
    ]);
  });

  it("asks Postgres for NULLS LAST and the same cdr_id direction", () => {
    const asc = flattenSql(durationOrderSql("asc"));
    expect(asc.text).toContain("ASC NULLS LAST, c.cdr_id ASC");
    const desc = flattenSql(durationOrderSql("desc"));
    expect(desc.text).toContain("DESC NULLS LAST, c.cdr_id DESC");
  });
});

describe("duration keyset", () => {
  const lastNumber = { elapsed: "999", cdrId: "m" };
  const firstBlank = { elapsed: "", cdrId: "z" };

  it("steps from the last number into the blank tail and through that tail", () => {
    expect(durationRowFollowsCursor(firstBlank, lastNumber, "asc")).toBe(true);
    expect(durationRowFollowsCursor(lastNumber, firstBlank, "asc")).toBe(false);
    expect(durationRowFollowsCursor({ elapsed: "", cdrId: "a" }, firstBlank, "asc")).toBe(false);
    expect(durationRowFollowsCursor({ elapsed: "", cdrId: "zz" }, firstBlank, "asc")).toBe(true);
    expect(durationRowFollowsCursor(firstBlank, lastNumber, "desc")).toBe(true);
    expect(durationRowFollowsCursor({ elapsed: "1000", cdrId: "a" }, lastNumber, "desc")).toBe(
      false,
    );
    expect(durationRowFollowsCursor({ elapsed: "", cdrId: "a" }, firstBlank, "desc")).toBe(true);
    expect(durationRowFollowsCursor({ elapsed: "", cdrId: "zz" }, firstBlank, "desc")).toBe(
      false,
    );
  });

  it("binds a numeric cursor and keeps the blank tail in the predicate", () => {
    const numeric = flattenSql(durationKeysetSql("desc", { elapsed: "1,5", cdrId: "m" }));
    expect(numeric.text).toContain("::numeric");
    expect(numeric.text).toContain("IS NULL");
    expect(numeric.text).toContain("<");
    expect(numeric.values).toContain("1.5");
    expect(numeric.values).toContain("m");

    const blank = flattenSql(durationKeysetSql("asc", { elapsed: "", cdrId: "z" }));
    expect(blank.text).toContain("IS NULL AND c.cdr_id >");
    expect(blank.values).toEqual(["z"]);
  });
});
