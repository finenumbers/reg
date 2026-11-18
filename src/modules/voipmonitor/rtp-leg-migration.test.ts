import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261118160000_rtp_leg_index/migration.sql",
  ),
  "utf8",
);
const backfill = readFileSync(
  path.join(process.cwd(), "scripts/rtp-leg-index-backfill.mjs"),
  "utf8",
);

function statements(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

describe("rtp leg index migration", () => {
  it("adds nullable columns and leaves the CDR journal unread", () => {
    const sql = statements(migration);
    expect(migration).toContain("SET LOCAL lock_timeout = '15s'");
    expect(migration).toContain('ADD COLUMN "out_host" TEXT');
    expect(migration).toContain('ADD COLUMN "in_host" TEXT');
    expect(migration).toContain('ADD COLUMN "out_audio" BOOLEAN');
    expect(migration).toContain('ADD COLUMN "in_audio" BOOLEAN');
    expect(migration).toContain('ADD COLUMN "cdr_date" TEXT');
    expect(sql).not.toContain("cdr_records");
    expect(sql).not.toContain("create index");
    expect(sql).not.toContain("not null");
  });

  it("fills hosts in the script and does not rewrite a CDR row", () => {
    const sql = statements(backfill);
    expect(backfill).toContain("indexVoipmonitorLegs");
    expect(sql).not.toMatch(/update\s+cdr_records/);
    expect(sql).not.toMatch(/insert\s+into\s+cdr_records/);
    expect(sql).not.toMatch(/delete\s+from\s+cdr_records/);
    expect(backfill).toContain("LEFT JOIN cdr_records");
    expect(backfill).toContain("WHERE out_audio = false");
    expect(backfill).toContain("WHERE in_audio = false");
    expect(backfill).toContain("SET NOT NULL");
  });
});
