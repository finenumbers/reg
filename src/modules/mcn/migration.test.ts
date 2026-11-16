import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261116191000_mcn_source/migration.sql"),
  "utf8",
);

describe("MCN Telecom source migration", () => {
  it("adds the key, the lease, the draft, and the epoch counters", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(sql.replace(/--.*$/gm, "")).not.toContain("cdr_records");
    expect(sql).not.toContain("free_numbers");
    expect(sql).not.toContain("purchased_numbers");
    expect(sql).not.toContain("decorate_generation");
    expect(sql).toContain(`"mcn_epoch" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"mcn_done" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"mcnApiKeyCiphertext" TEXT`);
    expect(sql).toContain(`CHECK ("id" = 1)`);
    expect(sql).toContain(`CHECK ("list" IN ('', 'purchased', 'free'))`);
    expect(sql).toContain(`CHECK ("catalog" IN ('free', 'purchased'))`);
    expect(sql).toContain(`INSERT INTO "mcn_sync_state" ("id") VALUES (1)`);
  });
});
