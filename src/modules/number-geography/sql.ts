/**
 * SQL projection for «География номеров».
 * City label and the PSTN key are one phrase each, shared by the list,
 * the count, and the facets. cdr_tariff_geo uses the same predicate as
 * cdr_tariff_direction. Geography calls it once, then geography_digit_split
 * trims the screen ABC. Filter values are bound parameters. Column names
 * come from the allowlist.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { PREMIUM_CAPACITY } from "@/modules/phones/capacity";
import { STATUS_BLOCKED } from "@/modules/phones/types";
import {
  EXPENSIVE_COLUMNS,
  FREE_CALL_DIRECTION,
  MOBILE_RF_DIRECTION,
  NUMBER_GEOGRAPHY_COLUMNS,
  type NumberGeographyColumn,
} from "@/modules/number-geography/columns";
import { CITY_DIRECTION_PREFIX } from "@/modules/traffic/call-class";

/** Same shape as normalizePstnPhone: 11 digits on 7/8 drop the first, else 10. */
export const PSTN_ELEVEN_DIGIT = "^[78][0-9]{10}$";
export const PSTN_TEN_DIGIT = "^[0-9]{10}$";

export type ListProjection = "page" | "catalog" | "empty";

export function pstnCacheKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (new RegExp(PSTN_ELEVEN_DIGIT).test(digits)) return digits.slice(1);
  if (new RegExp(PSTN_TEN_DIGIT).test(digits)) return digits;
  return null;
}

/**
 * Page: sort and limit first, then tariff and PSTN for that page.
 * Catalog: a city, ABC, local-number, operator, or geography filter must see every row.
 * Empty is reserved. Supplier is a cheap column like number and client.
 */
export function listProjection(filters: ColumnFilters): ListProjection {
  for (const column of EXPENSIVE_COLUMNS) {
    const values = filters[column];
    if (values && values.length > 0) return "catalog";
  }
  return "page";
}

export function facetProjection(
  column: NumberGeographyColumn,
  filters: ColumnFilters,
): ListProjection {
  const rest = { ...filters };
  delete rest[column];
  const base = listProjection(rest);
  if (base === "empty") return "empty";
  if (EXPENSIVE_COLUMNS.has(column)) return "catalog";
  return base;
}

/** Columns that actually restrict the query. */
export function activeFilterColumns(
  filters: ColumnFilters,
  excludeColumn?: string,
): NumberGeographyColumn[] {
  const out: NumberGeographyColumn[] = [];
  for (const column of NUMBER_GEOGRAPHY_COLUMNS) {
    if (column === excludeColumn) continue;
    const values = filters[column];
    if (!values || values.length === 0) continue;
    out.push(column);
  }
  return out;
}

function columnRef(column: NumberGeographyColumn): Prisma.Sql {
  switch (column) {
    case "category":
      return Prisma.sql`category`;
    case "city":
      return Prisma.sql`city`;
    case "region":
      return Prisma.sql`region`;
    case "abc":
      return Prisma.sql`abc`;
    case "telephone":
      return Prisma.sql`telephone`;
    case "supplier":
      return Prisma.sql`supplier`;
    case "number":
      return Prisma.sql`number`;
    case "client":
      return Prisma.sql`client`;
    case "capacity":
      return Prisma.sql`capacity`;
    case "operator":
      return Prisma.sql`operator`;
    case "geography":
      return Prisma.sql`geography`;
    case "title":
      return Prisma.sql`title`;
    case "activation":
      return Prisma.sql`activation`;
  }
}

/** Bound IN-list plus an empty-cell disjunct. Values never enter the SQL text. */
export function filterMatchSql(
  column: NumberGeographyColumn,
  values: string[],
): Prisma.Sql {
  const wantsEmpty = values.includes(EMPTY_FILTER_TOKEN);
  const texts = values.filter((value) => value !== EMPTY_FILTER_TOKEN);
  const expr = columnRef(column);
  const parts: Prisma.Sql[] = [];
  if (wantsEmpty) parts.push(Prisma.sql`${expr} = ''`);
  if (texts.length > 0) {
    parts.push(Prisma.sql`${expr} IN (${Prisma.join(texts)})`);
  }
  if (parts.length === 0) return Prisma.sql`TRUE`;
  if (parts.length === 1) return parts[0]!;
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

function andWhere(clauses: Prisma.Sql[]): Prisma.Sql {
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  if (clauses.length === 1) return clauses[0]!;
  return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
}

function whereFor(
  filters: ColumnFilters,
  scope: "cheap" | "expensive",
  excludeColumn?: string,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  for (const column of activeFilterColumns(filters, excludeColumn)) {
    const expensive = EXPENSIVE_COLUMNS.has(column);
    if (scope === "cheap" && expensive) continue;
    if (scope === "expensive" && !expensive) continue;
    clauses.push(filterMatchSql(column, filters[column] ?? []));
  }
  return andWhere(clauses);
}

function phoneLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Substring of the trimmed «Номер». A blank query matches every row. */
export function phoneNumberSql(phoneQ: string | undefined): Prisma.Sql | null {
  const q = phoneQ?.trim() ?? "";
  if (!q) return null;
  return Prisma.sql`number ILIKE ${phoneLikePattern(q)} ESCAPE '\\'`;
}

export function cheapWhere(
  filters: ColumnFilters,
  excludeColumn?: string,
  phoneQ?: string,
  blockedOnly = false,
): Prisma.Sql {
  const base = whereFor(filters, "cheap", excludeColumn);
  const phone = phoneNumberSql(phoneQ);
  let where = phone ? Prisma.sql`(${base} AND ${phone})` : base;
  if (blockedOnly) {
    where = Prisma.sql`(${where} AND activation = ${STATUS_BLOCKED})`;
  }
  return where;
}

/** «Заблокировано» across the number list. Search and column filters stay out. */
export function blockedCountSql(): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte}
    SELECT count(*)::int AS n
    FROM base
    WHERE activation = ${STATUS_BLOCKED}
  `;
}

export function expensiveWhere(
  filters: ColumnFilters,
  excludeColumn?: string,
): Prisma.Sql {
  return whereFor(filters, "expensive", excludeColumn);
}

const baseCte = Prisma.sql`
  base AS (
    SELECT
      e.id,
      btrim(e."endpointNumber") AS number,
      btrim(COALESCE(e.data->>'Описание', '')) AS client,
      CASE
        WHEN btrim(COALESCE(e.data->>'ТЕРМ. емкость', '')) = '' THEN ${PREMIUM_CAPACITY}
        ELSE btrim(e.data->>'ТЕРМ. емкость')
      END AS capacity,
      btrim(COALESCE(e.data->>'Поставщик', '')) AS supplier,
      btrim(COALESCE(e.data->>'Категория', '')) AS category,
      btrim(COALESCE(e.data->>'Статус', '')) AS activation,
      CASE
        WHEN btrim(COALESCE(e.data->>'Название', '')) <> ''
          THEN btrim(e.data->>'Название')
        ELSE btrim(e.name)
      END AS title
    FROM phone_endpoints e
    WHERE e."endpointNumber" IS NOT NULL
      AND btrim(e."endpointNumber") <> ''
  )
`;

function pstnKeyFromDigits(digits: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN ${digits} ~ ${PSTN_ELEVEN_DIGIT} THEN substring(${digits} FROM 2)
      WHEN ${digits} ~ ${PSTN_TEN_DIGIT} THEN ${digits}
      ELSE NULL
    END
  )`;
}

/** City label. `direction` is the direction from the matched tariff row. */
export function cityLabelSql(direction: Prisma.Sql): Prisma.Sql {
  const start = CITY_DIRECTION_PREFIX.length + 1;
  const bare = CITY_DIRECTION_PREFIX.trim();
  return Prisma.sql`(
    CASE
      WHEN ${direction} IS NULL OR btrim(${direction}) = '' THEN ''
      WHEN btrim(${direction}) = ${bare} THEN ''
      WHEN starts_with(btrim(${direction}), ${CITY_DIRECTION_PREFIX})
        THEN btrim(substring(btrim(${direction}) FROM ${start}::int))
      ELSE btrim(${direction})
    END
  )`;
}

/** Tariff row that used to paint red. The screen now paints it yellow. */
export function cityAlertSql(direction: Prisma.Sql): Prisma.Sql {
  const start = CITY_DIRECTION_PREFIX.length + 1;
  return Prisma.sql`(
    CASE
      WHEN ${direction} IS NULL OR btrim(${direction}) = '' THEN TRUE
      WHEN btrim(${direction}) = ${MOBILE_RF_DIRECTION}
        OR btrim(${direction}) = ${FREE_CALL_DIRECTION} THEN FALSE
      WHEN starts_with(btrim(${direction}), ${CITY_DIRECTION_PREFIX})
        AND btrim(substring(btrim(${direction}) FROM ${start}::int)) <> '' THEN FALSE
      ELSE TRUE
    END
  )`;
}

/**
 * unresolved: no PSTN key, or a cache row that did not find an operator.
 * pending: a key with no cache row yet. resolved: a non-empty operator.
 * pstn_phone alone cannot tell a short number from a cache miss.
 */
export function pstnStatusSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN pstn_key IS NULL THEN ${"unresolved"}
      WHEN pstn_phone IS NULL THEN ${"pending"}
      WHEN pstn_found IS NOT TRUE
        OR pstn_operator IS NULL
        OR btrim(pstn_operator) = '' THEN ${"unresolved"}
      ELSE ${"resolved"}
    END
  )`;
}

function operatorLabelSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN pstn_phone IS NULL THEN ''
      WHEN pstn_found IS NOT TRUE
        OR pstn_operator IS NULL
        OR btrim(pstn_operator) = '' THEN ${MISSING_PSTN_LABEL}
      ELSE btrim(pstn_operator)
    END
  )`;
}

function geographyLabelSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN pstn_phone IS NULL THEN ''
      WHEN pstn_found IS NOT TRUE
        OR pstn_operator IS NULL
        OR btrim(pstn_operator) = '' THEN ${MISSING_PSTN_LABEL}
      WHEN pstn_geography IS NULL OR btrim(pstn_geography) = '' THEN ''
      ELSE btrim(pstn_geography)
    END
  )`;
}

function joinedFrom(source: Prisma.Sql, cheap: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    keyed AS (
      SELECT
        src.*,
        regexp_replace(src.number, '[^0-9]', '', 'g') AS digits
      FROM ${source} src
      WHERE ${cheap}
    ),
    joined AS (
      SELECT
        k.id,
        k.number,
        k.client,
        k.capacity,
        k.supplier,
        k.category,
        k.title,
        k.activation,
        geo.direction AS direction,
        geo.abc AS matched_abc,
        geo.region AS matched_region,
        geo.numbering AS matched_numbering,
        ${pstnKeyFromDigits(Prisma.sql`k.digits`)} AS pstn_key,
        c.phone AS pstn_phone,
        c.found AS pstn_found,
        c.operator AS pstn_operator,
        c."garTerritory" AS pstn_geography
      FROM keyed k
      LEFT JOIN LATERAL cdr_tariff_geo(k.number) AS geo ON TRUE
      LEFT JOIN pstn_phone_cache c
        ON c.phone = ${pstnKeyFromDigits(Prisma.sql`k.digits`)}
    )
  `;
}

function labeledSelect(): Prisma.Sql {
  return Prisma.sql`
    SELECT
      id,
      number,
      client,
      capacity,
      supplier,
      category,
      title,
      activation,
      ${pstnStatusSql()} AS pstn_status,
      ${cityLabelSql(Prisma.sql`direction`)} AS city,
      ${cityAlertSql(Prisma.sql`direction`)} AS city_alert,
      COALESCE(matched_region, '') AS region,
      split.abc AS abc,
      split.telephone AS telephone,
      ${operatorLabelSql()} AS operator,
      ${geographyLabelSql()} AS geography
    FROM joined
    CROSS JOIN LATERAL geography_digit_split(matched_abc, matched_numbering, number) AS split
  `;
}

export function pageCountSql(cheap: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte}
    SELECT count(*)::int AS n
    FROM base
    WHERE ${cheap}
  `;
}

export function pageListSql(
  cheap: Prisma.Sql,
  limit: number,
  offset: number,
): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte},
    page AS (
      SELECT *
      FROM base
      WHERE ${cheap}
      ORDER BY number ASC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    ),
    ${joinedFrom(Prisma.sql`page`, Prisma.sql`TRUE`)}
    ${labeledSelect()}
    ORDER BY number ASC, id ASC
  `;
}

export function catalogCountSql(cheap: Prisma.Sql, expensive: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte},
    ${joinedFrom(Prisma.sql`base`, cheap)},
    labeled AS (
      ${labeledSelect()}
    )
    SELECT count(*)::int AS n
    FROM labeled
    WHERE ${expensive}
  `;
}

export function catalogListSql(
  cheap: Prisma.Sql,
  expensive: Prisma.Sql,
  limit: number,
  offset: number,
): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte},
    ${joinedFrom(Prisma.sql`base`, cheap)},
    labeled AS (
      ${labeledSelect()}
    )
    SELECT *
    FROM labeled
    WHERE ${expensive}
    ORDER BY number ASC, id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export function pageFacetSql(
  column: NumberGeographyColumn,
  cheap: Prisma.Sql,
): Prisma.Sql {
  const expr = columnRef(column);
  return Prisma.sql`
    WITH ${baseCte}
    SELECT ${expr} AS value, count(*)::int AS count
    FROM base
    WHERE ${cheap}
    GROUP BY 1
  `;
}

export function catalogFacetSql(
  column: NumberGeographyColumn,
  cheap: Prisma.Sql,
  expensive: Prisma.Sql,
): Prisma.Sql {
  const expr = columnRef(column);
  return Prisma.sql`
    WITH ${baseCte},
    ${joinedFrom(Prisma.sql`base`, cheap)},
    labeled AS (
      ${labeledSelect()}
    )
    SELECT ${expr} AS value, count(*)::int AS count
    FROM labeled
    WHERE ${expensive}
    GROUP BY 1
  `;
}

/**
 * Operator and geography labels for a handful of endpoints.
 * Same CASE as the table. No tariff lookup.
 */
export function pstnLabelsByIdsSql(ids: string[]): Prisma.Sql {
  const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  return Prisma.sql`
    WITH src AS (
      SELECT
        e.id,
        btrim(e."endpointNumber") AS number
      FROM phone_endpoints e
      WHERE e.id IN (${idList})
        AND e."endpointNumber" IS NOT NULL
        AND btrim(e."endpointNumber") <> ''
    ),
    keyed AS (
      SELECT
        src.id,
        regexp_replace(src.number, '[^0-9]', '', 'g') AS digits
      FROM src
    ),
    joined AS (
      SELECT
        k.id,
        c.phone AS pstn_phone,
        c.found AS pstn_found,
        c.operator AS pstn_operator,
        c."garTerritory" AS pstn_geography
      FROM keyed k
      LEFT JOIN pstn_phone_cache c
        ON c.phone = ${pstnKeyFromDigits(Prisma.sql`k.digits`)}
    )
    SELECT
      id,
      ${operatorLabelSql()} AS operator,
      ${geographyLabelSql()} AS geography
    FROM joined
  `;
}
