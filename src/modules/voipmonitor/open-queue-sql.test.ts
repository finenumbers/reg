import { describe, expect, it } from "vitest";
import { LIVE_PRIORITY_MS } from "@/modules/voipmonitor/constants";
import { openQueueWhereSql } from "@/modules/voipmonitor/open-queue-sql";

describe("openQueueWhereSql", () => {
  const now = new Date("2026-09-01T08:00:00.000Z");

  it("always binds now and requires cdrAt + due-or-missing link", () => {
    const sql = openQueueWhereSql(now);
    const text = sql.strings.join("?");
    expect(text).toContain('c."cdrAt" IS NOT NULL');
    expect(text).toContain("l.cdr_record_id IS NULL");
    expect(text).toContain("l.next_attempt_at");
    expect(sql.values).toContainEqual(now);
  });

  it("adds a live lower bound", () => {
    const sql = openQueueWhereSql(now, "live");
    const text = sql.strings.join("?");
    expect(text).toContain('c."cdrAt" >=');
    expect(sql.values).toContainEqual(new Date(now.getTime() - LIVE_PRIORITY_MS));
  });

  it("adds an archive upper bound", () => {
    const sql = openQueueWhereSql(now, "archive");
    const text = sql.strings.join("?");
    expect(text).toContain('c."cdrAt" <');
    expect(text).not.toContain('c."cdrAt" >=');
  });
});
