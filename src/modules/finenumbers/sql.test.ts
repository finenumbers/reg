import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { catalogEpochSql } from "@/modules/numbering-catalog/decorate";
import {
  decidePublish,
  DELETE_FREE_CHUNK_SQL,
  DELETE_PURCHASED_CHUNK_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
} from "@/modules/finenumbers/sql";

const migration = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261117150000_finenumbers_source/migration.sql"),
  "utf8",
);

function insertShape(sql: string, table: string): { columns: number; expressions: string } {
  const header = `INSERT INTO ${table} (`;
  const insertAt = sql.indexOf(header);
  const selectAt = sql.indexOf("SELECT", insertAt);
  const fromAt = sql.indexOf("FROM picked", selectAt);
  const columns = sql.slice(insertAt + header.length, sql.indexOf(")", insertAt)).split(",").length;
  const expressions = sql.slice(selectAt + "SELECT".length, fromAt);
  return { columns, expressions };
}

describe("Finenumbers publish SQL", () => {
  it("copies the number and leaves operator and geography empty", () => {
    const free = insertShape(FREE_COPY_SQL, "free_numbers");
    const purchased = insertShape(PURCHASED_COPY_SQL, "purchased_numbers");
    expect(free.columns).toBe(free.expressions.split(",").length);
    expect(free.columns).toBe(15);
    expect(purchased.columns).toBe(purchased.expressions.split(",").length);
    expect(purchased.columns).toBe(16);
    expect(free.expressions).not.toMatch(/\boperator\b/);
    expect(free.expressions).not.toMatch(/\bgeography\b/);
    expect(purchased.expressions).not.toMatch(/\boperator\b/);
    expect(purchased.expressions).not.toMatch(/\bgeography\b/);
    expect(free.expressions.trim().endsWith("'',\n      '',\n      e164")).toBe(true);
    expect(purchased.expressions.trim().endsWith("'',\n      '',\n      e164")).toBe(true);
  });

  it("deletes only the Finenumbers slice of both catalogs", () => {
    expect(DELETE_FREE_CHUNK_SQL).toContain("provider = 'Finenumbers'");
    expect(DELETE_PURCHASED_CHUNK_SQL).toContain("provider = 'Finenumbers'");
    const epoch = catalogEpochSql("finenumbers", "both");
    expect(epoch).toContain("finenumbers_epoch = finenumbers_epoch + 1");
    expect(epoch).toContain("finenumbers_parsed = 0");
    expect(epoch).toContain("finenumbers_scope = 'both'");
  });

  it("commits only when the staged counts match and the catalogs do not share a number", () => {
    expect(
      decidePublish({
        held: true,
        expected: 3,
        overlap: 0,
        stagedFree: 2,
        insertedFree: 2,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("commit");
    expect(
      decidePublish({
        held: true,
        expected: 3,
        overlap: 1,
        stagedFree: 2,
        insertedFree: 2,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("rollback");
  });

  it("adds the lease and the range snapshot without rewriting catalogs", () => {
    expect(migration).toContain("SET LOCAL lock_timeout = '15s'");
    expect(migration).toContain(`CHECK ("id" = 1)`);
    expect(migration).toContain(`CHECK ("catalog" IN ('free', 'purchased'))`);
    expect(migration).toContain(`INSERT INTO "finenumbers_sync_state" ("id") VALUES (1)`);
    expect(migration).toContain(`"pstn_range_epoch" INTEGER NOT NULL DEFAULT 0`);
    expect(migration).toContain(`DROP TABLE "geography_did_sources"`);
    expect(migration).toContain(`DROP COLUMN "didApiTokenCiphertext"`);
    const body = migration.replace(/--.*$/gm, "");
    expect(body).not.toContain("free_numbers");
    expect(body).not.toContain("purchased_numbers");
    expect(body).not.toContain("cdr_records");
    expect(body).not.toContain("decorate_generation");
  });
});
