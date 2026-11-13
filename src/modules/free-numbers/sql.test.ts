import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
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
    expect(flat.text).toContain("region IN");
    expect(flat.text).toContain(`"number" = ''`);
    expect(flat.text).toContain(`"number" ILIKE ? ESCAPE '\\'`);
    expect(flat.values).toEqual(["0495", "Москва", "%12\\%3\\_a%"]);
  });

  it("leaves the open column out of a facet and matches a compact amount", () => {
    const where = freeNumberWhere({ purchase: ["100"], city: ["Казань"] }, "", "purchase");
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
    expect(list.values).toEqual([100, 200]);

    const first = flattenSql(freeNumberKeysetSql(where, null, 500));
    expect(first.text).not.toContain("OFFSET");
    expect(first.text).not.toContain("abc >");

    const next = flattenSql(
      freeNumberKeysetSql(where, { abc: "495", number: "100", id: "row" }, 500),
    );
    expect(next.text).toContain("abc > ?");
    expect(next.text).toContain(`"number" > ?`);
    expect(next.text).toContain("id > ?");
    expect(next.values).toEqual(["495", "495", "100", "495", "100", "row", 500]);
  });
});
