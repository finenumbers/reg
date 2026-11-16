import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261116040000_geography_abc_text/migration.sql",
);

const FREE_CALL = 'geography_abc_text(e164, abc, "number")';
const RTU_CALL = "geography_abc_text(number, abc, telephone)";

function functionBody(sql: string): string {
  const marker = /CREATE FUNCTION geography_abc_text\b[\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$/;
  return marker.exec(sql)?.[1] ?? "";
}

describe("geography_abc_text sql", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = functionBody(sql);

  it("wraps one leading 7 and leaves every other code stored", () => {
    expect(sql).toContain("LANGUAGE sql");
    expect(sql).toContain("IMMUTABLE");
    expect(sql).toContain("SET search_path = public");
    expect(body).toContain("COALESCE(abc, '') <> ''");
    expect(body).toContain("left(COALESCE(abc, ''), 1) = '7'");
    expect(body).toContain("length(COALESCE(abc, '')) = 1 THEN '7'");
    expect(body).toContain("'7 (' || substring(COALESCE(abc, '') FROM 2) || ')'");
    expect(body).toContain("left(COALESCE(abc, ''), 1) <> '7'");
    expect(body).toContain("'7' || COALESCE(abc, '') || COALESCE(telephone, '')");
    expect(body).toContain("'7 (' || COALESCE(abc, '') || ')'");
    expect(body).toContain("ELSE COALESCE(abc, '')");
    expect(body).not.toContain("7 ()");
  });

  it("indexes the same calls the menus send", () => {
    expect(sql).toContain(
      `CREATE INDEX "free_numbers_abc_text_order_idx"\n    ON "free_numbers" (${FREE_CALL}, abc, "number", id);`,
    );
    expect(sql).toContain(
      `CREATE INDEX "purchased_numbers_abc_text_order_idx"\n    ON "purchased_numbers" (${FREE_CALL}, abc, "number", id);`,
    );
    expect(sql).toContain(
      `CREATE INDEX "rtu_screen_abc_text_order_idx"\n    ON "rtu_screen" (${RTU_CALL}, number, id);`,
    );
    expect(sql).toContain("SET LOCAL lock_timeout = '15s'");
    expect(sql).not.toContain("UPDATE ");
    expect(sql).not.toContain("DELETE ");
    expect(sql).not.toContain("ALTER TABLE");
    expect(sql).not.toContain("DROP ");
  });
});
