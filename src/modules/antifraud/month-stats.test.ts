import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  antifraudCardMonthSql,
  antifraudJournalMonthSql,
} from "@/modules/antifraud/month-stats";

function flatten(sql: Prisma.Sql): string {
  return sql.strings.join(" ");
}

describe("antifraud month stats SQL", () => {
  it("counts the journal by the UTC month and skips rows without a date", () => {
    const text = flatten(antifraudJournalMonthSql());
    expect(text).toContain("FROM radius_calls");
    expect(text).toContain("logged_at IS NOT NULL");
    expect(text).toContain("AT TIME ZONE 'UTC'");
  });

  it("counts a card on the newest SMG month and treats a null delay array as absent", () => {
    const text = flatten(antifraudCardMonthSql());
    expect(text).toContain("MAX(left(disconnect_day, 7))");
    expect(text).toContain("unique_tag_norm");
    expect(text).toContain("radius_session_norm");
    expect(text).toContain("af_ms_dev IS NOT NULL");
    expect(text).toContain("smg_call_traces");
  });
});
