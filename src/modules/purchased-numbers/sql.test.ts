import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
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
    expect(flat.text).toContain("region IN");
    expect(flat.text).toContain(`"number" = ''`);
    expect(flat.text).toContain(`e164 ILIKE ? ESCAPE '\\'`);
    expect(flat.text).toContain(`"number" ILIKE ? ESCAPE '\\'`);
    expect(flat.values).toEqual(["0495", "Москва", "Секрет", "%12\\%3\\_a%", "%12\\%3\\_a%"]);
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
    expect(list.values).toEqual([100, 200]);

    const first = flattenSql(purchasedNumberKeysetSql(where, null, 500));
    expect(first.text).not.toContain("OFFSET");
    expect(first.text).not.toContain("abc >");

    const next = flattenSql(
      purchasedNumberKeysetSql(where, { abc: "495", number: "100", id: "row" }, 500),
    );
    expect(next.text).toContain("abc > ?");
    expect(next.text).toContain(`"number" > ?`);
    expect(next.text).toContain("id > ?");
    expect(next.values).toEqual(["495", "495", "100", "495", "100", "row", 500]);
  });
});
