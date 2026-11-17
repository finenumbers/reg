import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MOBILE_RF_DIRECTION, shownRegionBindingValues } from "@/modules/rtu/columns";
import {
  freeNumberFacetSql,
  freeNumberKeysetSql,
  freeNumberListSql,
  freeNumberWhere,
} from "@/modules/free-numbers/sql";

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

describe("free-number SQL", () => {
  it("binds filters and escapes a phone search", () => {
    const flat = flattenSql(
      freeNumberWhere(
        {
          client: ["Секрет"],
          region: ["Москва"],
          number: [EMPTY_FILTER_TOKEN, "0495"],
        },
        "12%3_a",
      ),
    );
    expect(flat.text).not.toContain("client");
    expect(flat.text).not.toContain("Секрет");
    expect(flat.text).toContain("btrim(city) = ? THEN geography");
    expect(flat.text).toContain("ELSE region");
    expect(flat.text).toContain(`"number" = ''`);
    expect(flat.text).toContain(`e164 ILIKE ? ESCAPE '\\'`);
    expect(flat.text).toContain(`"number" ILIKE ? ESCAPE '\\'`);
    expect(flat.values).toEqual([
      "0495",
      ...shownRegionBindingValues(),
      MOBILE_RF_DIRECTION,
      "Москва",
      "%12\\%3\\_a%",
      "%12\\%3\\_a%",
    ]);
  });

  it("leaves the open column out of a facet and matches a compact amount", () => {
    const where = freeNumberWhere(
      { purchase: ["100"], city: ["Казань"] },
      "",
      "purchase",
    );
    const flat = flattenSql(freeNumberFacetSql("purchase", where, "1 500", 201));
    expect(flat.text).not.toContain("purchase IN");
    expect(flat.text).toContain("city IN");
    expect(flat.text).toContain("replace(replace(purchase");
    expect(flat.text).toContain("LIMIT ?");
    expect(flat.text).not.toContain("OFFSET");
    expect(flat.values).toContain("Казань");
    expect(flat.values).toContain("%1 500%");
    expect(flat.values).toContain("%1500%");
    expect(flat.values).toContain(201);
  });

  it("orders the list and walks the export by key", () => {
    const where = freeNumberWhere({}, "");
    const list = flattenSql(freeNumberListSql(where, 100, 200));
    expect(list.text).toContain('ORDER BY abc ASC, "number" ASC, id ASC');
    expect(list.text).toContain("LIMIT ? OFFSET ?");
    expect(list.values).toEqual([
      ...shownRegionBindingValues(),
      MOBILE_RF_DIRECTION,
      100,
      200,
    ]);

    const first = flattenSql(freeNumberKeysetSql(where, null, 500));
    expect(first.text).not.toContain("OFFSET");
    expect(first.text).not.toContain("abc >");

    const next = flattenSql(
      freeNumberKeysetSql(where, { abc: "495", number: "100", id: "row" }, 500),
    );
    expect(next.text).toContain("abc > ?");
    expect(next.text).toContain(`"number" > ?`);
    expect(next.text).toContain("id > ?");
    expect(next.values).toEqual([
      ...shownRegionBindingValues(),
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
      freeNumberWhere({ abc: ["7 (383)", EMPTY_FILTER_TOKEN], city: ["Казань"] }, ""),
    );
    expect(where.text).toContain(`${screen} IN`);
    expect(where.text).toContain("abc = ''");
    expect(where.text).toContain("city IN");
    expect(where.text).not.toContain("abc IN");
    expect(where.text).not.toContain("abc ILIKE");
    expect(where.values).toEqual(["7 (383)", "Казань"]);

    const facet = flattenSql(
      freeNumberFacetSql(
        "abc",
        freeNumberWhere({ city: ["Казань"] }, "495", "abc"),
        "7 (383)",
        201,
      ),
    );
    expect(facet.text).toContain(`SELECT ${screen} AS value, count(*)::int AS count`);
    expect(facet.text).toContain(`${screen} ILIKE ?`);
    expect(facet.text).toContain("GROUP BY 1");
    expect(facet.text).toContain("city IN");
    expect(facet.text).not.toContain("abc ILIKE");
    expect(facet.text).not.toContain("abc IN");
    expect(facet.values).toEqual(["Казань", "%495%", "%495%", "%7 (383)%", 201]);

    const empty = flattenSql(
      freeNumberFacetSql("abc", freeNumberWhere({}, "", "abc"), "пусто", 201),
    );
    expect(empty.text).toContain(`${screen} ILIKE ?`);
    expect(empty.text).toContain("abc = ''");
    expect(empty.text).not.toContain("abc ILIKE");
    expect(empty.values).toEqual(["%пусто%", 201]);

    const city = flattenSql(
      freeNumberFacetSql("city", freeNumberWhere({}, "", "city"), "Ка", 10),
    );
    expect(city.text).not.toContain("geography_abc_text");
    expect(city.text).toContain("city ILIKE");

    const list = flattenSql(
      freeNumberListSql(freeNumberWhere({ abc: ["7 (383)"] }, ""), 10, 0),
    );
    expect(list.text).toContain("\n  abc,\n");
    expect(list.text).not.toMatch(/SELECT\s+geography_abc_text/);
    expect(list.text).toContain(`${screen} IN`);
  });
});
