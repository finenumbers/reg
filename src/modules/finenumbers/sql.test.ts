import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FINENUMBERS_EPOCH_SQL } from "@/modules/numbering-catalog/decorate";
import { decidePublish, DELETE_FREE_CHUNK_SQL, DELETE_PURCHASED_CHUNK_SQL } from "@/modules/finenumbers/sql";

const migration = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261117150000_finenumbers_source/migration.sql"),
  "utf8",
);

describe("Finenumbers publish SQL", () => {
  it("deletes only the Finenumbers slice of both catalogs", () => {
    expect(DELETE_FREE_CHUNK_SQL).toContain("provider = 'Finenumbers'");
    expect(DELETE_PURCHASED_CHUNK_SQL).toContain("provider = 'Finenumbers'");
    expect(FINENUMBERS_EPOCH_SQL).toContain("finenumbers_epoch = finenumbers_epoch + 1");
    expect(FINENUMBERS_EPOCH_SQL).toContain("finenumbers_parsed = 0");
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
