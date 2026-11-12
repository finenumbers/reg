import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261113003000_number_masks_column_order/migration.sql",
  ),
  "utf8",
);

const COLUMN_LIST =
  '"id", "sortIndex", "digitLength", "category", "abc", "mask", "maskType", "purchase", "premium"';

describe("number_masks column order migration", () => {
  it("copies purchase before premium by name and checks the copy before drop", () => {
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    const lists = [...sql.matchAll(/"id",\s*"sortIndex",[\s\S]*?"premium"/g)].map((match) =>
      match[0].replace(/\s+/g, " "),
    );
    expect(lists).toEqual([COLUMN_LIST, COLUMN_LIST]);
    expect(sql.indexOf("RAISE EXCEPTION 'number_masks column copy drifted'")).toBeGreaterThan(0);
    expect(sql.indexOf("RAISE EXCEPTION 'number_masks column copy drifted'")).toBeLessThan(
      sql.indexOf('DROP TABLE "number_masks"'),
    );
  });
});
