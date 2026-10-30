import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import {
  FREE_CALL_DIRECTION,
  MOBILE_RF_DIRECTION,
} from "@/modules/number-geography/columns";
import {
  activeFilterColumns,
  catalogListSql,
  cityAlertSql,
  cityLabelSql,
  facetProjection,
  filterMatchSql,
  listProjection,
  pageListSql,
  PSTN_ELEVEN_DIGIT,
  PSTN_TEN_DIGIT,
  pstnCacheKey,
} from "@/modules/number-geography/sql";
import { normalizePstnPhone } from "@/modules/pstn/types";
import { CITY_DIRECTION_PREFIX } from "@/modules/traffic/call-class";

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

describe("list projection", () => {
  it("keeps number and client filters on the cheap page path", () => {
    expect(listProjection({ number: ["79001112233"], client: ["А"] })).toBe(
      "page",
    );
    expect(listProjection({ supplier: [EMPTY_FILTER_TOKEN] })).toBe("page");
  });

  it("uses the full catalog when city or operator is filtered", () => {
    expect(listProjection({ city: ["Москва"] })).toBe("catalog");
    expect(listProjection({ operator: ["МТС"], number: ["7900"] })).toBe(
      "catalog",
    );
    expect(listProjection({ geography: ["край"] })).toBe("catalog");
  });

  it("returns no rows when supplier is filtered to a real value", () => {
    expect(listProjection({ supplier: ["Ростелеком"] })).toBe("empty");
    expect(
      listProjection({ supplier: [EMPTY_FILTER_TOKEN, "Ростелеком"] }),
    ).toBe("page");
  });

  it("still projects the catalog for a city facet when other filters are cheap", () => {
    expect(facetProjection("city", { number: ["7900"] })).toBe("catalog");
    expect(facetProjection("client", { number: ["7900"] })).toBe("page");
    expect(facetProjection("number", { city: ["Москва"] })).toBe("catalog");
    expect(facetProjection("client", { supplier: ["нет такого"] })).toBe(
      "empty",
    );
  });
});

describe("filter clauses", () => {
  it("drops the open column and ignores an empty supplier", () => {
    expect(
      activeFilterColumns(
        {
          city: ["Москва"],
          number: ["7900"],
          supplier: [EMPTY_FILTER_TOKEN],
          unknown: ["x"],
        },
        "city",
      ),
    ).toEqual(["number"]);
  });

  it("binds filter text and does not paste it into the statement", () => {
    const hostile = "Москва'); DROP TABLE phone_endpoints;--";
    const flat = flattenSql(
      filterMatchSql("city", [hostile, EMPTY_FILTER_TOKEN]),
    );
    expect(flat.text).not.toContain("DROP TABLE");
    expect(flat.text).toContain("= ''");
    expect(flat.values).toContain(hostile);
    expect(flat.values).not.toContain(EMPTY_FILTER_TOKEN);
  });
});

describe("pstn cache key", () => {
  it("matches normalizePstnPhone", () => {
    const samples = [
      "79001112233",
      "89001112233",
      "9001112233",
      "7 (900) 111-22-33",
      "123",
      "",
      "790011122334",
      "+7 495 000-00-00",
    ];
    for (const sample of samples) {
      expect(pstnCacheKey(sample)).toBe(normalizePstnPhone(sample));
    }
  });

  it("puts the same patterns in the join", () => {
    const flat = flattenSql(pageListSql(Prisma.sql`TRUE`, 100, 0));
    expect(flat.values).toContain(PSTN_ELEVEN_DIGIT);
    expect(flat.values).toContain(PSTN_TEN_DIGIT);
  });
});

describe("city sql phrase", () => {
  it("binds the same literals the label function uses", () => {
    const label = flattenSql(cityLabelSql(Prisma.sql`direction`));
    const alert = flattenSql(cityAlertSql(Prisma.sql`direction`));
    expect(label.values).toContain(CITY_DIRECTION_PREFIX);
    expect(label.values).toContain(CITY_DIRECTION_PREFIX.trim());
    expect(alert.values).toContain(MOBILE_RF_DIRECTION);
    expect(alert.values).toContain(FREE_CALL_DIRECTION);
    expect(alert.values).toContain(CITY_DIRECTION_PREFIX);
    expect(label.text).toContain("starts_with");
    expect(alert.text).toContain("starts_with");
  });

  it("rates only the limited page unless a catalog filter is on", () => {
    const page = flattenSql(pageListSql(Prisma.sql`TRUE`, 100, 0));
    expect(page.text.indexOf("LIMIT")).toBeLessThan(
      page.text.indexOf("cdr_tariff_direction"),
    );
    const catalog = flattenSql(
      catalogListSql(Prisma.sql`TRUE`, Prisma.sql`city = ?`, 100, 0),
    );
    expect(catalog.text.indexOf("cdr_tariff_direction")).toBeLessThan(
      catalog.text.lastIndexOf("LIMIT"),
    );
    expect(catalog.values).toContain(MISSING_PSTN_LABEL);
  });
});
