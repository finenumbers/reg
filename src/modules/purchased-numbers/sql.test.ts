import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import {
  purchasedNumberFacetSql,
  purchasedNumberKeysetSql,
  purchasedNumberListSql,
  purchasedNumberWhere,
} from "@/modules/purchased-numbers/sql";

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

describe("purchased-number SQL", () => {
  it("binds the client filter and ignores a free-number column", () => {
    const flat = flattenSql(
      purchasedNumberWhere(
        {
          client: ["Секрет"],
          incomingPurchase: ["10"],
          region: ["Москва"],
          number: [EMPTY_FILTER_TOKEN, "0495"],
        },
        "12%3_a",
      ),
    );
    expect(flat.text).toContain("client IN");
    expect(flat.text).not.toContain("Секрет");
    expect(flat.text).not.toContain("incomingPurchase");
    expect(flat.text).not.toContain("free_numbers");
    expect(flat.text).toContain("btrim(city) = ? THEN geography");
    expect(flat.text).toContain("ELSE region");
    expect(flat.text).toContain(`"number" = ''`);
    expect(flat.text).toContain(`e164 ILIKE ? ESCAPE '\\'`);
    expect(flat.text).toContain(`"number" ILIKE ? ESCAPE '\\'`);
    expect(flat.values).toEqual([
      "0495",
      MOBILE_RF_DIRECTION,
      "Москва",
      "Секрет",
      "%12\\%3\\_a%",
      "%12\\%3\\_a%",
    ]);
  });

  it("reads purchased_numbers and leaves a client search ungrouped", () => {
    const where = purchasedNumberWhere({ client: ["1000"] }, "", "client");
    const flat = flattenSql(purchasedNumberFacetSql("client", where, "1 000", 201));
    expect(flat.text).toContain("FROM purchased_numbers");
    expect(flat.text).not.toContain("free_numbers");
    expect(flat.text).not.toContain("incomingPurchase");
    expect(flat.text).not.toContain("client IN");
    expect(flat.text).not.toContain("replace(replace(client");
    expect(flat.text).toContain("LIMIT ?");
    expect(flat.values).toContain("%1 000%");
    expect(flat.values).not.toContain("%1000%");

    const list = flattenSql(purchasedNumberListSql(purchasedNumberWhere({}, ""), 100, 0));
    expect(list.text).toContain("FROM purchased_numbers");
    expect(list.text).toContain("client");
    expect(list.text).not.toContain("incomingPurchase");
    expect(list.text).not.toContain("free_numbers");
  });

  it("orders the list and walks the export by key", () => {
    const where = purchasedNumberWhere({}, "");
    const list = flattenSql(purchasedNumberListSql(where, 100, 200));
    expect(list.text).toContain('ORDER BY abc ASC, "number" ASC, id ASC');
    expect(list.text).toContain("LIMIT ? OFFSET ?");
    expect(list.values).toEqual([MOBILE_RF_DIRECTION, 100, 200]);

    const first = flattenSql(purchasedNumberKeysetSql(where, null, 500));
    expect(first.text).not.toContain("OFFSET");
    expect(first.text).not.toContain("abc >");

    const next = flattenSql(
      purchasedNumberKeysetSql(where, { abc: "495", number: "100", id: "row" }, 500),
    );
    expect(next.text).toContain("abc > ?");
    expect(next.text).toContain(`"number" > ?`);
    expect(next.text).toContain("id > ?");
    expect(next.values).toEqual([
      MOBILE_RF_DIRECTION,
      "495",
      "495",
      "100",
      "495",
      "100",
      "row",
      500,
    ]);
  });

  it("filters and searches ABC by the screen text", () => {
    const screen = 'geography_abc_text(e164, abc, "number")';
    const where = flattenSql(
      purchasedNumberWhere({ abc: ["7 (3012)"], client: ["Секрет"] }, ""),
    );
    expect(where.text).toContain(`${screen} IN`);
    expect(where.text).toContain("client IN");
    expect(where.text).not.toContain("abc IN");
    expect(where.text).not.toContain("abc ILIKE");
    expect(where.values).toEqual(["7 (3012)", "Секрет"]);

    const facet = flattenSql(
      purchasedNumberFacetSql(
        "abc",
        purchasedNumberWhere({ client: ["Секрет"] }, "", "abc"),
        "3012",
        201,
      ),
    );
    expect(facet.text).toContain("FROM purchased_numbers");
    expect(facet.text).toContain(`SELECT ${screen} AS value, count(*)::int AS count`);
    expect(facet.text).toContain(`${screen} ILIKE ?`);
    expect(facet.text).toContain("client IN");
    expect(facet.text).not.toContain("abc ILIKE");
    expect(facet.text).not.toContain("abc IN");
    expect(facet.values).toEqual(["Секрет", "%3012%", 201]);

    const list = flattenSql(
      purchasedNumberListSql(purchasedNumberWhere({ abc: ["7 (3012)"] }, ""), 10, 0),
    );
    expect(list.text).toContain("\n  abc,\n");
    expect(list.text).not.toMatch(/SELECT\s+geography_abc_text/);
  });
});
