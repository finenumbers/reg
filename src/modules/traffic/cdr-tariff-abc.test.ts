import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = path.join(process.cwd(), "prisma/migrations");

function latestFunctionBody(name: string): string {
  let body = "";
  const marker = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION ${name}\\b[\\s\\S]*?AS \\$fn\\$([\\s\\S]*?)\\$fn\\$`,
    "g",
  );
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, dir, "migration.sql");
    let sql = "";
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    marker.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(sql))) body = match[1] ?? "";
  }
  return body;
}

function fromTariffRates(body: string): string {
  const at = body.indexOf("FROM tariff_rates");
  return body.slice(at).trim();
}

describe("cdr_tariff_abc", () => {
  it("uses the same tariff predicate as cdr_tariff_direction", () => {
    const direction = latestFunctionBody("cdr_tariff_direction");
    const abc = latestFunctionBody("cdr_tariff_abc");
    expect(direction).toContain("SELECT t.direction");
    expect(abc).toContain("SELECT t.abc");
    expect(abc).not.toContain("SELECT t.direction");
    expect(fromTariffRates(abc)).toBe(fromTariffRates(direction));
  });

  it("does not replace the CDR rater", () => {
    const sql = readFileSync(
      path.join(MIGRATIONS, "20261106180000_cdr_tariff_abc/migration.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE FUNCTION cdr_tariff_abc");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION cdr_tariff_direction");
    expect(sql).not.toContain("FUNCTION cdr_rate_call");
    expect(sql).not.toContain("DROP FUNCTION");
  });
});
