import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  purgeAuditBatchSql,
  purgeAuditCountSql,
  purgeDeleteBatchSql,
  purgeJobsBatchSql,
  purgeJobsCountSql,
  purgeMonthPrefixSql,
  purgeSmgBatchSql,
  purgeSmgCountSql,
  utcMonthInterval,
} from "@/modules/traffic/purge/sql";

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  const walk = (node: Prisma.Sql) => {
    const strings = node.strings;
    const rawValues = node.values;
    for (let i = 0; i < strings.length; i++) {
      text.push(strings[i] ?? "");
      if (i >= rawValues.length) continue;
      const value = rawValues[i];
      if (value instanceof Prisma.Sql) {
        walk(value);
      } else {
        text.push("?");
        values.push(value);
      }
    }
  };
  walk(sql);
  return { text: text.join(""), values };
}

describe("purge SQL", () => {
  it("scopes DELETE to the cdr_date month prefix", () => {
    const prefix = purgeMonthPrefixSql(2025, 1);
    expect(prefix.strings.join("")).toContain("cdr_date LIKE");
    expect(prefix.values).toContain("2025-01-%");
    const del = purgeDeleteBatchSql(2025, 1, 2000);
    expect(del.strings.join(" ")).toContain("DELETE FROM cdr_records");
    expect(del.values).toContain("2025-01-%");
  });

  it("deletes SMG rows by the disconnect_day range, including December", () => {
    const count = flattenSql(purgeSmgCountSql(2026, 12));
    expect(count.text).toContain("COUNT(*)::bigint");
    expect(count.text).toContain("FROM smg_cdr_records");
    expect(count.text).toContain("disconnect_day >=");
    expect(count.text).toContain("disconnect_day <");
    expect(count.values).toEqual(["2026-12-01", "2027-01-01"]);

    const del = flattenSql(purgeSmgBatchSql(2026, 9, 2000));
    expect(del.text).toContain("DELETE FROM smg_cdr_records");
    expect(del.values).toEqual(["2026-09-01", "2026-10-01", 2000]);
  });
});

describe("utc month history purge", () => {
  it("uses UTC bounds and keeps the current purge job", () => {
    const { start, end } = utcMonthInterval(2026, 7);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");

    const jobs = flattenSql(purgeJobsBatchSql(start, end, "job_purge"));
    expect(jobs.text).toContain("DELETE FROM job_runs");
    expect(jobs.text).toContain('"startedAt"');
    expect(jobs.text).toContain("id <>");
    expect(jobs.values).toEqual([start, end, "job_purge", 2000]);

    const jobsCount = flattenSql(purgeJobsCountSql(start, end, "job_purge"));
    expect(jobsCount.text).toContain("COUNT(*)::bigint");
    expect(jobsCount.text).toContain('"startedAt"');
    expect(jobsCount.text).toContain("id <>");
    expect(jobsCount.values).toEqual([start, end, "job_purge"]);

    const audit = flattenSql(purgeAuditBatchSql(start, end));
    expect(audit.text).toContain("DELETE FROM audit_logs");
    expect(audit.text).toContain('"createdAt"');
    expect(audit.values).toEqual([start, end, 2000]);

    const auditCount = flattenSql(purgeAuditCountSql(start, end));
    expect(auditCount.text).toContain("COUNT(*)::bigint");
    expect(auditCount.text).toContain('"createdAt"');
    expect(auditCount.values).toEqual([start, end]);
  });
});
