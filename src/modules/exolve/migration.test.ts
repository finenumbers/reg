import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261116080000_exolve_source/migration.sql"),
  "utf8",
);

describe("MTS Exolve source migration", () => {
  it("adds the key, the lease, the draft, and the epoch counters", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(sql.replace(/--.*$/gm, "")).not.toContain("cdr_records");
    expect(sql).not.toContain("free_numbers");
    expect(sql).not.toContain("purchased_numbers");
    expect(sql).not.toContain("decorate_generation");
    expect(sql).toContain(`"exolve_epoch" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"exolve_done" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"exolveApiKeyCiphertext" TEXT`);
    expect(sql).toContain(`CHECK ("id" = 1)`);
    expect(sql).toContain(`CHECK ("list" IN ('', 'purchased', 'free'))`);
    expect(sql).toContain(`CHECK ("catalog" IN ('free', 'purchased'))`);
    expect(sql).toContain(`INSERT INTO "exolve_sync_state" ("id") VALUES (1)`);
  });
});
