import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261116010000_catalog_sale_columns/migration.sql",
  ),
  "utf8",
);

const NEXT_LIST =
  '"id", "provider", "abc", "number", "category", "city", "region", "purchase", "subscription", "mask", "maskType", "sale", "premium", "operator", "geography", "e164"';

describe("free_numbers sale column migration", () => {
  it("copies the old money cells by name and checks them before drop", () => {
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    const insertAt = sql.indexOf('INSERT INTO "free_numbers_next"');
    const insertList = sql
      .slice(insertAt)
      .match(/"id",[\s\S]*?"e164"/)?.[0]
      .replace(/\s+/g, " ");
    expect(insertList).toBe(NEXT_LIST);
    const createBody = sql.slice(0, insertAt);
    let pos = 0;
    for (const name of NEXT_LIST.split(", ")) {
      const found = createBody.indexOf(name, pos);
      expect(found).toBeGreaterThanOrEqual(0);
      pos = found + name.length;
    }
    expect(sql).toContain('o."incomingPurchase" IS DISTINCT FROM n."purchase"');
    expect(sql).toContain('o."incomingPeriod" IS DISTINCT FROM n."subscription"');
    expect(sql).toContain('o."purchase" IS DISTINCT FROM n."sale"');
    expect(sql.indexOf("RAISE EXCEPTION 'free_numbers column copy drifted'")).toBeLessThan(
      sql.indexOf('DROP TABLE "free_numbers"'),
    );
    expect(sql.indexOf('DROP TABLE "free_numbers"')).toBeLessThan(
      sql.indexOf('CREATE INDEX "free_numbers_order_idx"'),
    );
    expect(sql).toContain('ALTER TABLE "rtu_screen" RENAME COLUMN "purchase" TO "sale"');
  });
});
