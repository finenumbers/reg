import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { sanitizeLogLine } from "@/modules/exolve/log";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/exolve/reclaim";
import {
  DELETE_EXOLVE_FREE_SQL,
  DELETE_EXOLVE_PURCHASED_SQL,
  EXOLVE_PROVIDER,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  decidePublish,
  fillSplitSql,
} from "@/modules/exolve/sql";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    const value = sql.values[i];
    if (value instanceof Prisma.Sql) text.push(flattenSql(value));
    else if (typeof value === "string") text.push(value);
  }
  return text.join("");
}

describe("Exolve catalog SQL", () => {
  it("replaces only the MTS Exolve slice and copies purchased prices", () => {
    expect(EXOLVE_PROVIDER).toBe("MTS Exolve");
    expect(DELETE_EXOLVE_FREE_SQL).toContain("provider = 'MTS Exolve'");
    expect(DELETE_EXOLVE_PURCHASED_SQL).toContain("provider = 'MTS Exolve'");
    expect(FREE_COPY_SQL).toContain("incoming_purchase");
    expect(FREE_COPY_SQL).toContain("'MTS Exolve'");
    expect(PURCHASED_COPY_SQL).toContain("incoming_purchase");
    expect(PURCHASED_COPY_SQL).toContain("incoming_period");
    expect(PURCHASED_COPY_SQL).toContain("subscription");
    expect(FREE_COPY_SQL).not.toContain("ON CONFLICT");
    expect(PURCHASED_COPY_SQL).not.toContain("ON CONFLICT");
    expect(flattenSql(fillSplitSql("run", 10))).toContain("exolve_sync_stage");
    expect(decidePublish({
      held: true,
      stagedFree: 0,
      insertedFree: 0,
      stagedPurchased: 0,
      insertedPurchased: 0,
    })).toBe("commit");
  });

  it("drops the lease without touching catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).toContain("exolve_sync_state");
    expect(text).toContain("DELETE FROM exolve_sync_stage");
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
  });

  it("strips a secret from the stage log", () => {
    expect(sanitizeLogLine("Bearer secret-key")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("https://api.exolve.ru/number/v1/GetFree")).toBe(
      "Площадка отклонила запрос.",
    );
    expect(sanitizeLogLine("free type=1104 region=10230 offset=0 status=200")).toBe(
      "free type=1104 region=10230 offset=0 status=200",
    );
  });
});
