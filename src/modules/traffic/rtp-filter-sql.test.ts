import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { escapeLike } from "@/modules/oprs/filter-sql";
import {
  buildTrafficNoRtpFacetSql,
  buildTrafficNoRtpPageSql,
  buildTrafficNoRtpSliceSql,
  trafficNoRtpCanMatch,
  trafficSqlAppliesRtpGate,
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
  it("reads the partial index for one checkbox and ORs a stored flag", () => {
    const slice = buildTrafficNoRtpSliceSql(input());
    const flat = flattenSql(slice.where);
    const from = flattenSql(slice.from);
    expect(from.text.indexOf("SELECT cdr_record_id")).toBeLessThan(
      from.text.indexOf("JOIN cdr_records"),
    );
    expect(from.text).toContain("out_audio = false");
    expect(from.text).toContain("out_host <>");
    expect(from.text).not.toContain("regexp_replace");
    expect(from.text).not.toContain("->>'audio'");
    expect(from.values).toContain("gui.example");
    expect(from.values).toContain("2026-11-%");
    expect(flat.values).toContain("2026-11-%");
    expect(flat.values).not.toContain("Нет");
    expect(flat.values).not.toContain(CALL_CATEGORY.outgoing);
    expect(flat.values).not.toContain(MOBILE_RF_DIRECTION);
    expect(flat.values).not.toContain(CALL_STATUS.failed);

    const bothSlice = buildTrafficNoRtpSliceSql(
      input({ flags: { noRtp: true, failed: true } }),
    );
    const both = flattenSql(bothSlice.where);
    const bothFrom = flattenSql(bothSlice.from);
    expect(bothFrom.text).toBe("cdr_records c");
    expect(both.text).toContain(" OR ");
    expect(both.text).toContain("out_audio = false");
    expect(both.text).not.toContain("AND NOT");
    expect(both.text).not.toContain("->>'audio'");
    expect(both.values).toContain(CALL_STATUS.failed);
    expect(both.values).toContain("gui.example");
    expect(both.values).not.toContain("Нет");
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
    expect(from.text).not.toContain("cdr_voipmonitor_links");
    expect(flat.text).toContain("FALSE");
    expect(flat.text).not.toContain("out_host");
    expect(flat.values).not.toContain(CALL_CATEGORY.outgoing);
  });

  it("searches a displayed date and drops a column that is not on the CDR", () => {
    const facet = flattenSql(
      buildTrafficNoRtpFacetSql(input(), "cdr_date", "28.12.2026", 20),
    );
    expect(
      facet.values.some(
        (value) => typeof value === "string" && value.includes("2026-12-28"),
      ),
    ).toBe(true);
    expect(
      facet.values.some(
        (value) => typeof value === "string" && value.includes("28.12.2026"),
      ),
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

  it("orders a seconds sort numerically and leaves the date order otherwise", () => {
    const seconds = flattenSql(
      buildTrafficNoRtpPageSql(input({ durationSort: "asc", timeSort: "desc" }), 100, 0),
    );
    expect(seconds.text).toContain("ASC NULLS LAST");
    expect(seconds.text).toContain("c.cdr_id ASC");
    expect(seconds.text).not.toContain("ELSE 0");
    expect(seconds.text).not.toContain("c.cdr_date ASC");

    const dated = flattenSql(
      buildTrafficNoRtpPageSql(input({ timeSort: "asc" }), 100, 0),
    );
    expect(dated.text).toContain("c.cdr_date ASC, c.cdr_id ASC");
    expect(dated.text).not.toContain("NULLS LAST");

    const cost = flattenSql(
      buildTrafficNoRtpPageSql(
        input({ chargeSort: "desc", durationSort: "asc", timeSort: "asc" }),
        100,
        0,
      ),
    );
    expect(cost.text).toContain("tariff_charge");
    expect(cost.text).toContain("DESC NULLS LAST, c.cdr_id DESC");
    expect(cost.text).not.toContain("c.cdr_date ASC");
    expect(cost.text).not.toContain("c.cdr_date DESC");
    expect(cost.text).not.toContain("ELSE 0");
  });

  it("does not treat a seconds sort as the empty RTP shortcut", () => {
    expect(trafficSqlAppliesRtpGate(true)).toBe(true);
    expect(trafficSqlAppliesRtpGate(false)).toBe(false);
    expect(trafficSqlAppliesRtpGate(undefined)).toBe(false);
  });
});
