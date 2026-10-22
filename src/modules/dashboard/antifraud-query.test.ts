import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  answerMinutesSql,
  delayMinutesSql,
  timeoutMinutesSql,
} from "@/modules/dashboard/antifraud-query";
import { utcCallWindow } from "@/modules/dashboard/concurrency";

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  const strings = sql.strings;
  const rawValues = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= rawValues.length) continue;
    const value = rawValues[i];
    if (value instanceof Prisma.Sql) {
      const inner = flattenSql(value);
      text.push(inner.text);
      values.push(...inner.values);
    } else {
      text.push("?");
      values.push(value);
    }
  }
  return { text: text.join(""), values };
}

const afternoon = utcCallWindow(new Date("2026-10-16T14:22:30.000Z"));

describe("antifraud chart sql", () => {
  it("counts answers by the UTC instant, not by date_trunc", () => {
    const sql = flattenSql(answerMinutesSql(afternoon));
    expect(sql.text).not.toContain("date_trunc");
    expect(sql.text).toContain("floor(extract(epoch FROM instant) / 60)");
    expect(sql.text).toContain("lower(btrim(c.device_sign))");
    expect(sql.text).toContain("make_timestamptz");
    expect(sql.text).toContain("af_category IS NOT NULL");
    expect(sql.values).toContain("2026-10-16 00:00:00");
    expect(sql.values).toContain("2026-10-16 21:23:00");
    expect(sql.values).toContain("Europe/Moscow");
  });

  it("keeps a delay sample only after one card is selected", () => {
    const sql = flattenSql(delayMinutesSql(afternoon));
    const cards = sql.text.indexOf("count(DISTINCT trace_id)");
    const unnest = sql.text.indexOf("unnest(af_ms_dev)");
    expect(cards).toBeGreaterThan(-1);
    expect(unnest).toBeGreaterThan(cards);
    expect(sql.text).not.toContain("date_trunc");
    expect(sql.text).toContain("cards = 1");
    expect(sql.text).toContain("af_ms_dev IS NOT NULL");
    expect(sql.text).not.toContain("c.device_ip");
  });

  it("counts parking journal rows by logged_at", () => {
    const sql = flattenSql(timeoutMinutesSql(afternoon));
    expect(sql.text).not.toContain("date_trunc");
    expect(sql.text).toContain("floor(extract(epoch FROM logged_at) / 60)");
    expect(sql.text).toContain("logged_at IS NOT NULL");
    expect(sql.text).not.toContain("smg_cdr_records");
    expect(sql.values).toContain(afternoon.dayStart);
    expect(sql.values).toContain(afternoon.recentStart);
  });
});
