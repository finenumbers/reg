import { describe, expect, it } from "vitest";
import {
  buildSyncCdrAtSql,
  CDR_DATE_CIVIL_REGEX,
} from "@/modules/traffic/sync-cdr-at";

describe("syncCdrAt SQL contract", () => {
  const built = buildSyncCdrAtSql();
  const text = built.strings.join(" ");

  it("computes civil UTC once and skips already-aligned rows", () => {
    expect(text).toContain("make_timestamptz");
    expect(text).toContain("'UTC'");
    expect(text).toContain("IS DISTINCT FROM");
    expect(text).toContain("v.parsed");
    expect(text).not.toMatch(/importedAt|imported_at/);
    expect(text).not.toMatch(/cdr_date\s+LIKE/i);
  });

  it("keeps the unanchored civil regex so fractional seconds still sync", () => {
    expect(CDR_DATE_CIVIL_REGEX.startsWith("^")).toBe(true);
    expect(CDR_DATE_CIVIL_REGEX.endsWith("$")).toBe(false);
    expect(built.values).toEqual([CDR_DATE_CIVIL_REGEX]);
  });
});
