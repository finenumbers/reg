import { describe, expect, it } from "vitest";
import { purgeDeleteBatchSql, purgeMonthPrefixSql } from "@/modules/traffic/purge/sql";

describe("purge SQL", () => {
  it("scopes DELETE to the cdr_date month prefix", () => {
    const prefix = purgeMonthPrefixSql(2025, 1);
    expect(prefix.strings.join("")).toContain("cdr_date LIKE");
    expect(prefix.values).toContain("2025-01-%");
    const del = purgeDeleteBatchSql(2025, 1, 2000);
    expect(del.strings.join(" ")).toContain("DELETE FROM cdr_records");
    expect(del.values).toContain("2025-01-%");
  });
});
