import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261116060000_aurora_source/migration.sql"),
  "utf8",
);

describe("Aurora source migration", () => {
  it("adds the lease, the draft, and the file list without rewriting catalogs", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(sql.replace(/--.*$/gm, "")).not.toContain("cdr_records");
    expect(sql).not.toContain("free_numbers");
    expect(sql).not.toContain("purchased_numbers");
    expect(sql).not.toContain("decorate_generation");
    expect(sql).toContain(`"aurora_epoch" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"aurora_done" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`CHECK ("id" = 1)`);
    expect(sql).toContain(`CHECK ("format" IN ('short', 'full'))`);
    expect(sql).toContain(`CHECK ("list" IN ('', 'free'))`);
    expect(sql).toContain("INSERT INTO \"aurora_sync_state\" (\"id\") VALUES (1)");
  });
});
