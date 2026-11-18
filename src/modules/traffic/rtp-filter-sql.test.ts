import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { escapeLike } from "@/modules/oprs/filter-sql";
import {
  buildTrafficNoRtpFacetSql,
  buildTrafficNoRtpSliceSql,
  trafficNoRtpCanMatch,
  type TrafficNoRtpSqlInput,
} from "@/modules/traffic/rtp-filter-sql";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    if (i >= sql.values.length) continue;
    const value = sql.values[i];
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

function input(patch: Partial<TrafficNoRtpSqlInput> = {}): TrafficNoRtpSqlInput {
  return {
    year: 2026,
    month: 11,
    filters: {},
    phoneQ: "",
    flags: { noRtp: true },
    guiHost: "gui.example",
    timeSort: null,
    ...patch,
  };
}

describe("traffic absent RTP sql", () => {
  it("uses the RTP case, the month, and OR with an unsuccessful call", () => {
    const flat = flattenSql(buildTrafficNoRtpSliceSql(input()).where);
    const from = flattenSql(buildTrafficNoRtpSliceSql(input()).from);
    expect(from.text).toContain("cdr_voipmonitor_links");
    expect(flat.text).toContain("->>'audio'");
    expect(flat.values).toContain("Нет");
    expect(flat.values).toContain("gui.example");
    expect(flat.values).toContain("2026-11-%");
    expect(flat.values).not.toContain(CALL_CATEGORY.outgoing);
    expect(flat.values).not.toContain(MOBILE_RF_DIRECTION);
    expect(flat.values).not.toContain(CALL_STATUS.failed);

    const both = flattenSql(
      buildTrafficNoRtpSliceSql(input({ flags: { noRtp: true, failed: true } })).where,
    );
    expect(both.text).toContain(" OR ");
    expect(both.values).toContain(CALL_STATUS.failed);
    expect(both.values).toContain("Нет");
  });

  it("does not read legs when the host is empty", () => {
    expect(trafficNoRtpCanMatch({ noRtp: true }, "")).toBe(false);
    expect(trafficNoRtpCanMatch({ noRtp: true, failed: true }, "")).toBe(true);
    const flat = flattenSql(
      buildTrafficNoRtpSliceSql(input({ guiHost: "", flags: { noRtp: true } })).where,
    );
    const from = flattenSql(
      buildTrafficNoRtpSliceSql(input({ guiHost: "", flags: { noRtp: true } })).from,
    );
    expect(from.text).not.toContain("voipmonitor_legs");
    expect(flat.text).toContain("FALSE");
    expect(flat.values).not.toContain(CALL_CATEGORY.outgoing);
  });

  it("searches a displayed date and drops a column that is not on the CDR", () => {
    const facet = flattenSql(
      buildTrafficNoRtpFacetSql(input(), "cdr_date", "28.12.2026", 20),
    );
    expect(
      facet.values.some((value) => typeof value === "string" && value.includes("2026-12-28")),
    ).toBe(true);
    expect(
      facet.values.some((value) => typeof value === "string" && value.includes("28.12.2026")),
    ).toBe(true);

    const poisoned = flattenSql(
      buildTrafficNoRtpSliceSql(
        input({
          filters: { "c.id = 'x' OR c.id": ["1"], bill_ani: ["7900"] },
          phoneQ: "%",
        }),
      ).where,
    );
    expect(poisoned.text).not.toContain("c.id = 'x'");
    expect(poisoned.values).toContain("7900");
    expect(poisoned.values).toContain(`%${escapeLike("%")}%`);
  });
});
