import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { emptyBlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { OPRS_EXTERNAL_NETWORK } from "@/modules/oprs/derived";
import { PARKING_DST } from "@/modules/stats/classify";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import { CALL_CATEGORY } from "@/modules/traffic/call-class";
import { markingStatsSql } from "@/modules/marking/stats-sql";

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

describe("marking stats sql", () => {
  it("counts one month of OPRS calls by the marking client", () => {
    const flat = flattenSql(
      markingStatsSql({
        year: 2026,
        month: 11,
        tones: { "ПАО МТС": "red" },
        blocked: emptyBlockedNumberIndex(),
      }),
    );
    expect(flat.text).toContain("cdr_date >=");
    expect(flat.text).toContain("cdr_date <");
    expect(flat.text).not.toContain("LIKE");
    expect(flat.text).not.toContain("phone_endpoints");
    expect(flat.text).not.toContain("cdr_day");
    expect(flat.text).toContain("COALESCE(client, '')");
    expect(flat.text).toContain("btrim(c.bill_ani)");
    expect(flat.text).toContain("GROUP BY 1, 2");
    expect(flat.values).toContain("2026-11-01");
    expect(flat.values).toContain("2026-12-01");
    expect(flat.values).toContain(OPRS_EXTERNAL_NETWORK);
    expect(flat.values).toContain("МТС");
    expect(flat.values).toContain("ПАО МТС");
    expect(flat.values).toContain(CALL_CATEGORY.outgoing);
    expect(flat.values).toContain(MOBILE_RF_DIRECTION);
    expect(flat.values).toContain(PARKING_DST);
    expect(flat.values).toContain(MISSING_PSTN_LABEL);
    expect(flat.text).not.toContain("unnest");
  });
});
