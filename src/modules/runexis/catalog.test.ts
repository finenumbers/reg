import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/recompute";
import {
  acceptShowcasePage,
  nationalDigits,
  parseAccessToken,
  parseShowcasePage,
} from "@/modules/runexis/parse";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/runexis/reclaim";
import { sanitizeLogLine } from "@/modules/runexis/log";
import {
  DELETE_RUNEXIS_FREE_SQL,
  FREE_COPY_SQL,
  decidePublish,
  fillSplitSql,
  stageInsertSql,
} from "@/modules/runexis/sql";
import { loginUrl, showcaseUrl } from "@/modules/runexis/url";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  const strings = sql.strings;
  const values = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= values.length) continue;
    const value = values[i];
    text.push(value instanceof Prisma.Sql ? flattenSql(value) : "?");
  }
  return text.join("");
}

describe("runexis showcase", () => {
  it("asks only for a page of 30", () => {
    expect(loginUrl()).toBe("https://didapi.runexis.ru/api/v1/login");
    expect(showcaseUrl(0)).toBeNull();
    expect(showcaseUrl(1.5)).toBeNull();
    const url = new URL(showcaseUrl(2) ?? "");
    expect(url.origin).toBe("https://didapi.runexis.ru");
    expect(url.pathname).toBe("/api/v1/numbers/showcase");
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "page"]);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("30");
  });

  it("keeps digit text and rejects a numeric code", () => {
    expect(nationalDigits("090", "1234567")).toBe("0901234567");
    expect(nationalDigits("901", "1234567")).toBe("9011234567");
    expect(nationalDigits(901, "1234567")).toBeNull();
    expect(nationalDigits("7", "123456789")).toBeNull();
    const page = parseShowcasePage({
      success: true,
      data: [{ code: 901, number: "1234567" }],
      meta: { total: 1, page: 1, limit: 30 },
    });
    expect(page.ok).toBe(false);
  });

  it("accepts a short page only when the count lands on the total", () => {
    expect(acceptShowcasePage({ total: 0, got: 0, acceptedBefore: 0 })).toBe("done");
    expect(acceptShowcasePage({ total: 31, got: 1, acceptedBefore: 30 })).toBe("done");
    expect(acceptShowcasePage({ total: 40, got: 10, acceptedBefore: 0 })).toBe("short");
    expect(acceptShowcasePage({ total: 10, got: 30, acceptedBefore: 0 })).toBe("over");
    expect(acceptShowcasePage({ total: 60, got: 30, acceptedBefore: 0 })).toBe("next");
    expect(parseAccessToken({ success: true, data: { token: "abc def" } })).toBeNull();
    expect(parseAccessToken({ success: true, data: { token: "abc" } })).toBe("abc");
  });

  it("replaces only Runexis free numbers", () => {
    expect(DELETE_RUNEXIS_FREE_SQL).toBe(
      "DELETE FROM free_numbers WHERE provider = 'Runexis'",
    );
    expect(DELETE_RUNEXIS_FREE_SQL).not.toContain("purchased_numbers");
    expect(FREE_COPY_SQL).toContain("INSERT INTO free_numbers");
    expect(FREE_COPY_SQL).toContain("'Runexis'");
    expect(FREE_COPY_SQL).not.toContain("DELETE");
    expect(FREE_COPY_SQL).not.toContain("purchased_numbers");
    expect(FREE_COPY_SQL).not.toContain("DISTINCT");
    expect(flattenSql(stageInsertSql("run", ["9011234567"]))).not.toContain(
      "ON CONFLICT",
    );
    expect(flattenSql(fillSplitSql("run", 2000))).toContain("LEFT JOIN");
    expect(flattenSql(fillSplitSql("run", 2000))).toContain("runexis_sync_stage");
    expect(flattenSql(fillSplitSql("run", 2000))).not.toContain("purchased_numbers");
    expect(decidePublish({ held: true, staged: 0, inserted: 0 })).toBe("commit");
    expect(decidePublish({ held: true, staged: 2, inserted: 1 })).toBe("rollback");
    expect(decidePublish({ held: false, staged: 1, inserted: 1 })).toBe("rollback");
  });

  it("drops the Runexis lease without touching catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
    expect(text).toContain("runexis_sync_state");
    expect(text).toContain("DELETE FROM runexis_sync_stage");
  });

  it("locks SipOut before Runexis", () => {
    expect(RESPLIT_LOCKS).toHaveLength(2);
    expect(RESPLIT_LOCKS[0]).toContain("numbering_sync_state");
    expect(RESPLIT_LOCKS[0]).not.toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[1]).toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[0]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[1]).toContain("FOR UPDATE");
  });

  it("strips a secret from the stage log", () => {
    expect(sanitizeLogLine("Bearer secret-token")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("password=secret")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("https://didapi.runexis.ru/api")).toBe(
      "Площадка отклонила запрос.",
    );
    expect(sanitizeLogLine("Страница 2")).toBe("Страница 2");
  });
});
