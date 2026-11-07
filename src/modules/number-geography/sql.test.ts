import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import {
  FREE_CALL_DIRECTION,
  geographyDigitAlign,
  MOBILE_RF_DIRECTION,
  NUMBER_GEOGRAPHY_COLUMNS,
  NUMBER_GEOGRAPHY_HEADERS,
} from "@/modules/number-geography/columns";
import {
  activeFilterColumns,
  catalogListSql,
  cheapWhere,
  cityAlertSql,
  cityLabelSql,
  facetProjection,
  filterMatchSql,
  listProjection,
  toolbarCountSql,
  pageFacetSql,
  pageListSql,
  PSTN_ELEVEN_DIGIT,
  PSTN_TEN_DIGIT,
  pstnCacheKey,
  pstnLabelsByIdsSql,
  pstnLabelsForNumbersSql,
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
    expect(listProjection({ number: ["79001112233"], client: ["А"] })).toBe("page");
    expect(listProjection({ supplier: [EMPTY_FILTER_TOKEN] })).toBe("page");
  });

  it("uses the full catalog when city or operator is filtered", () => {
    expect(listProjection({ city: ["Москва"] })).toBe("catalog");
    expect(listProjection({ operator: ["МТС"], number: ["7900"] })).toBe("catalog");
    expect(listProjection({ geography: ["край"] })).toBe("catalog");
  });

  it("keeps a supplier filter on the cheap page path", () => {
    expect(listProjection({ category: ["VIP"] })).toBe("page");
    expect(listProjection({ supplier: ["Ростелеком"] })).toBe("page");
    expect(listProjection({ supplier: [EMPTY_FILTER_TOKEN, "Ростелеком"] })).toBe("page");
    expect(listProjection({ source: ["MCN Telecom"] })).toBe("page");
    expect(facetProjection("source", { number: ["7900"] })).toBe("page");
  });

  it("still projects the catalog for a city facet when other filters are cheap", () => {
    expect(facetProjection("city", { number: ["7900"] })).toBe("catalog");
    expect(facetProjection("client", { number: ["7900"] })).toBe("page");
    expect(facetProjection("number", { city: ["Москва"] })).toBe("catalog");
    expect(facetProjection("client", { supplier: ["нет такого"] })).toBe("page");
  });
});

describe("phone search", () => {
  it("matches a substring of Номер and keeps the other cheap filters", () => {
    const flat = flattenSql(cheapWhere({ client: ["А"] }, undefined, "90%"));
    expect(flat.text).toContain("client IN");
    expect(flat.text).toContain("number ILIKE");
    expect(flat.text).toContain("ESCAPE '\\'");
    expect(flat.values).toContain("%90\\%%");
    expect(flat.values).toContain("А");
  });

  it("leaves a blank phone query out of the clause", () => {
    expect(flattenSql(cheapWhere({ number: ["1"] }, undefined, "  "))).toEqual(
      flattenSql(cheapWhere({ number: ["1"] })),
    );
  });

  it("keeps the phone query when the open facet is Номер", () => {
    const flat = flattenSql(
      cheapWhere({ number: ["7900"], city: ["Москва"] }, "number", "495"),
    );
    expect(flat.text).toContain("number ILIKE");
    expect(flat.text).not.toContain("number IN");
    expect(flat.values).toContain("%495%");
    expect(flat.values).not.toContain("7900");
  });
});

describe("filter clauses", () => {
  it("drops the open column and keeps an empty supplier filter", () => {
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
    ).toEqual(["supplier", "number"]);
  });

  it("binds filter text and does not paste it into the statement", () => {
    const hostile = "Москва'); DROP TABLE phone_endpoints;--";
    const flat = flattenSql(filterMatchSql("city", [hostile, EMPTY_FILTER_TOKEN]));
    expect(flat.text).not.toContain("DROP TABLE");
    expect(flat.text).toContain("= ''");
    expect(flat.values).toContain(hostile);
    expect(flat.values).not.toContain(EMPTY_FILTER_TOKEN);
  });
});

describe("geography columns", () => {
  it("places the phone column immediately before the title", () => {
    expect(NUMBER_GEOGRAPHY_COLUMNS.slice(0, 7)).toEqual([
      "category",
      "supplier",
      "source",
      "city",
      "region",
      "abc",
      "telephone",
    ]);
    const numberIndex = NUMBER_GEOGRAPHY_COLUMNS.indexOf("number");
    expect(NUMBER_GEOGRAPHY_COLUMNS[numberIndex + 1]).toBe("title");
    expect(NUMBER_GEOGRAPHY_COLUMNS.at(-1)).toBe("activation");
    expect(NUMBER_GEOGRAPHY_HEADERS.source).toBe("Источник");
    expect(NUMBER_GEOGRAPHY_HEADERS.number).toBe("Телефонный номер");
    expect(NUMBER_GEOGRAPHY_HEADERS.region).toBe("Регион");
    expect(NUMBER_GEOGRAPHY_HEADERS.abc).toBe("ABC");
    expect(NUMBER_GEOGRAPHY_HEADERS.telephone).toBe("Номер");
    expect(geographyDigitAlign("abc")).toBe("left");
    expect(geographyDigitAlign("telephone")).toBe("right");
    expect(geographyDigitAlign("number")).toBeNull();
  });

  it("keeps the activation column on the cheap path and out of the export filter", () => {
    expect(listProjection({ activation: ["Заблокировано"] })).toBe("page");
    const page = flattenSql(pageListSql(Prisma.sql`TRUE`, 10, 0));
    const facets = flattenSql(pageFacetSql("activation", Prisma.sql`TRUE`));
    expect(page.text).toContain("data->>'Статус'");
    expect(page.text).toContain("AS activation");
    expect(page.text).toContain("k.activation");
    const catalog = flattenSql(catalogListSql(Prisma.sql`TRUE`, Prisma.sql`TRUE`, 10, 0));
    expect(catalog.text).toContain("k.activation");
    const labels = flattenSql(pstnLabelsByIdsSql(["endpoint-1"]));
    expect(labels.text).not.toContain("k.activation");
    expect(facets.text).toContain("data->>'Статус'");
    const filtered = flattenSql(
      cheapWhere({}, undefined, undefined, {
        blockedOnly: true,
        unregisteredOnly: true,
        missingOnly: true,
      }),
    );
    expect(filtered.text).toContain("activation =");
    expect(filtered.text).toContain("unregistered");
    expect(filtered.text).toContain("missing");
    expect(filtered.values).toContain("Заблокировано");
    expect(filtered.text).not.toContain("Заблокировано");
    const counted = flattenSql(toolbarCountSql());
    expect(counted.text).toContain("data->>'Статус'");
    expect(counted.text).toContain("FILTER");
    expect(counted.text).toContain("reg_current");
    expect(counted.values).toContain("Заблокировано");
    expect(counted.values).toContain("Unregistered");
    expect(counted.text).toContain('::"RegStatus"');
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
    expect(flat.text).toContain("data->>'Поставщик'");
    expect(flat.text).toContain("data->>'Категория'");
    expect(flat.text).toContain("k.category");
    expect(flat.text).toContain("pstn_key");
    expect(flat.values).toContain("unresolved");
    expect(flat.values).toContain("pending");
    expect(flat.values).toContain("resolved");
    expect(flat.values).toContain("Премиум");
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
    expect(page.text.indexOf("LIMIT")).toBeLessThan(page.text.indexOf("cdr_tariff_geo"));
    expect(page.text.indexOf("LIMIT")).toBeLessThan(
      page.text.indexOf("geography_digit_split"),
    );
    expect(page.text).not.toContain("cdr_tariff_direction");
    expect(page.text).not.toContain("cdr_tariff_abc");
    const catalog = flattenSql(
      catalogListSql(Prisma.sql`TRUE`, Prisma.sql`city = ?`, 100, 0),
    );
    expect(catalog.text.indexOf("cdr_tariff_geo")).toBeLessThan(
      catalog.text.lastIndexOf("LIMIT"),
    );
    expect(catalog.text.indexOf("geography_digit_split")).toBeLessThan(
      catalog.text.lastIndexOf("LIMIT"),
    );
    expect(catalog.values).toContain(MISSING_PSTN_LABEL);
    expect(page.text).toContain("COALESCE(matched_region, '')");
    expect(page.text).toContain("AS region");
    expect(page.text).toContain("AS telephone");
    expect(page.text).toContain("geography_did_sources");
    expect(page.text).toContain("d.match_key = e.match_key");
    expect(page.text).toContain("e.match_key = d.match_key");
    expect(page.text).toContain('btrim(e."endpointNumber") AS number');
    expect(page.text).toContain('s."displayNumber" AS number');
    expect(page.text).toContain("AS source");
    expect(page.text).toContain("AS missing");
    expect(page.text).toContain("AS unregistered");
    expect(page.text).toContain("reg_current");
    expect(page.text).toContain('::"RegStatus"');
    expect(page.values).toContain("finenumbers");
    expect(page.values).toContain("Вручную");
    expect(page.values).toContain("Unregistered");
    expect(page.values).toContain("Нет в РТУ");
    const sourceFacet = flattenSql(pageFacetSql("source", Prisma.sql`TRUE`));
    expect(sourceFacet.text.indexOf("cdr_tariff_geo")).toBe(-1);
  });

  it("reads ABC and the local number through the catalog path", () => {
    expect(facetProjection("abc", {})).toBe("catalog");
    expect(facetProjection("telephone", {})).toBe("catalog");
    expect(facetProjection("region", {})).toBe("catalog");
    expect(listProjection({ abc: ["7383"] })).toBe("catalog");
    expect(listProjection({ telephone: ["480882"] })).toBe("catalog");
    expect(listProjection({ region: ["Приморский край"] })).toBe("catalog");
    expect(listProjection({})).toBe("page");
  });
});

describe("pstn labels by id", () => {
  it("uses the table's miss label and does not rate the number", () => {
    const hostile = "id'); DROP TABLE pstn_phone_cache;--";
    const flat = flattenSql(pstnLabelsByIdsSql([hostile, "endpoint-2"]));
    const byNumber = flattenSql(
      pstnLabelsForNumbersSql([{ id: hostile, number: "79001112233" }]),
    );
    expect(byNumber.text).toContain("::text");
    expect(byNumber.text).not.toContain("DROP TABLE");
    expect(byNumber.values).toContain(hostile);
    const page = flattenSql(pageListSql(Prisma.sql`TRUE`, 10, 0));
    expect(flat.text).not.toContain("DROP TABLE");
    expect(flat.text).not.toContain("cdr_tariff_direction");
    expect(flat.text).not.toContain("cdr_tariff_abc");
    expect(flat.text).toContain("pstn_phone IS NULL");
    expect(flat.values).toContain(hostile);
    expect(flat.values).toContain(MISSING_PSTN_LABEL);
    expect(page.values).toContain(MISSING_PSTN_LABEL);
    expect(flat.values.filter((value) => value === MISSING_PSTN_LABEL).length).toBe(
      page.values.filter((value) => value === MISSING_PSTN_LABEL).length,
    );
    expect(flat.text).toContain("btrim(pstn_geography) = '' THEN ''");
    expect(page.text).toContain("btrim(pstn_geography) = '' THEN ''");
  });
});
