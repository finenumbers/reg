import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/aurora/reclaim";
import {
  AURORA_PROVIDER,
  DELETE_AURORA_FREE_SQL,
  DELETE_AURORA_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  decidePublish,
} from "@/modules/aurora/sql";

function fieldCount(sql: string, start: string, end: string): number {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  return sql.slice(from + start.length, to).split(",").length;
}

describe("Aurora catalog copy", () => {
  it("writes the CSV price to free purchase and clears the purchased slice", () => {
    expect(AURORA_PROVIDER).toBe("Aurora Telecom");
    expect(DELETE_AURORA_FREE_SQL).toContain("provider = 'Aurora Telecom'");
    expect(DELETE_AURORA_PURCHASED_SQL).toContain("provider = 'Aurora Telecom'");
    expect(FREE_COPY_SQL).toContain("incoming_purchase");
    expect(FREE_COPY_SQL).not.toContain("incoming_period");
    expect(PURCHASED_COPY_SQL).not.toContain("incoming_purchase");
    expect(fieldCount(FREE_COPY_SQL, "INSERT INTO free_numbers (", ")")).toBe(
      fieldCount(FREE_COPY_SQL, "SELECT", "FROM"),
    );
    expect(fieldCount(PURCHASED_COPY_SQL, "INSERT INTO purchased_numbers (", ")")).toBe(
      fieldCount(PURCHASED_COPY_SQL, "SELECT", "FROM"),
    );
    expect(
      decidePublish({
        held: true,
        stagedFree: 2,
        insertedFree: 2,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("commit");
    expect(
      decidePublish({
        held: true,
        stagedFree: 2,
        insertedFree: 1,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("rollback");
  });

  it("deletes the inbox only after the catalog commit", () => {
    const service = readFileSync(
      path.join(process.cwd(), "src/modules/aurora/service.ts"),
      "utf8",
    );
    const publish = service.indexOf("await replaceAuroraCatalogs");
    const drop = service.indexOf("await dropCommittedInbox");
    const empty = service.indexOf("shouldPublishAurora");
    const stage = service.indexOf("await stageFreeNumbers");
    expect(publish).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(publish);
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(stage);
  });

  it("reclaims the lease and leaves the inbox", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).toContain("aurora_sync_state");
    expect(text).toContain("DELETE FROM aurora_sync_stage");
    expect(text).not.toContain("aurora_files");
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
  });
});
