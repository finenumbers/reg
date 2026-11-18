import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261118210000_purchased_provider_prices/migration.sql",
  ),
  "utf8",
);

describe("purchased provider price migration", () => {
  it("renames the mask price and adds the provider columns without rewriting rows", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql).toContain('RENAME COLUMN "purchase" TO "sale"');
    expect(sql).toContain(`ADD COLUMN "purchase" TEXT NOT NULL DEFAULT ''`);
    expect(sql).toContain(`ADD COLUMN "subscription" TEXT NOT NULL DEFAULT ''`);
    const body = sql.replace(/--.*$/gm, "");
    expect(body.toLowerCase()).not.toMatch(/\bupdate\b/);
    expect(body.toLowerCase()).not.toMatch(/\bdelete\b/);
    expect(body.toLowerCase()).not.toMatch(/select\s+\*/);
    expect(body).not.toContain("cdr_records");
  });
});
