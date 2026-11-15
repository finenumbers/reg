import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261116020000_catalog_decorate_epoch/migration.sql",
  ),
  "utf8",
);

describe("catalog decorate epoch migration", () => {
  it("adds the six counters and does not scan the journal", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(sql.replace(/--.*$/gm, "")).not.toContain("cdr_records");
    for (const column of [
      "sipout_epoch",
      "sipout_done",
      "runexis_epoch",
      "runexis_done",
      "uis_epoch",
      "uis_done",
    ]) {
      expect(sql).toContain(`"${column}" INTEGER NOT NULL DEFAULT 0`);
    }
  });
});
