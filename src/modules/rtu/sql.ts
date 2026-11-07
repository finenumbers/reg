/**
 * SQL projection for «Управление РТУ».
 * City label and the PSTN key are one phrase each, shared by the list,
 * the count, and the facets. cdr_tariff_geo uses the same predicate as
 * cdr_tariff_direction. Geography calls it once, then geography_digit_split
 * trims the screen ABC. Filter values are bound parameters. Column names
 * come from the allowlist. «Источник» is a cheap column joined from the DID
 * snapshot by one match key. Rows that are only in that snapshot are unioned
 * before the page limit. The tariff function still runs after that limit.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { STATUS_NOT_IN_RTU } from "@/modules/rtu/types";
import { PREMIUM_CAPACITY } from "@/modules/phones/capacity";
import { STATUS_BLOCKED } from "@/modules/phones/types";
import {
  EXPENSIVE_COLUMNS,
  FREE_CALL_DIRECTION,
  MOBILE_RF_DIRECTION,
  RTU_COLUMNS,
  type RtuColumn,
} from "@/modules/rtu/columns";
import { CITY_DIRECTION_PREFIX } from "@/modules/traffic/call-class";
import {
  FINENUMBERS_PROVIDER_CODE,
  GEOGRAPHY_MANUAL_SOURCE,
} from "@/modules/rtu/source-label";

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
 * One key for a full phone number.
 * 11 digits on 7 or 8, and a 10-digit number, share the PSTN key.
 * Any other digit string stays whole. A number with no digits keeps its text.
 */
export function geographyMatchKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const pstn = pstnCacheKey(trimmed);
  if (pstn) return `p:${pstn}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits) return `d:${digits}`;
  return `e:${trimmed}`;
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
  column: RtuColumn,
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
): RtuColumn[] {
  const out: RtuColumn[] = [];
  for (const column of RTU_COLUMNS) {
    if (column === excludeColumn) continue;
    const values = filters[column];
    if (!values || values.length === 0) continue;
    out.push(column);
  }
  return out;
}

function columnRef(column: RtuColumn): Prisma.Sql {
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
    case "source":
      return Prisma.sql`source`;
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
export function filterMatchSql(column: RtuColumn, values: string[]): Prisma.Sql {
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

export type CheapFlags = {
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
};

export function cheapWhere(
  filters: ColumnFilters,
  excludeColumn?: string,
  phoneQ?: string,
  flags: CheapFlags = {},
): Prisma.Sql {
  const base = whereFor(filters, "cheap", excludeColumn);
  const phone = phoneNumberSql(phoneQ);
  let where = phone ? Prisma.sql`(${base} AND ${phone})` : base;
  if (flags.blockedOnly) {
    where = Prisma.sql`(${where} AND activation = ${STATUS_BLOCKED})`;
  }
  if (flags.unregisteredOnly) {
    where = Prisma.sql`(${where} AND unregistered)`;
  }
  if (flags.missingOnly) {
    where = Prisma.sql`(${where} AND missing)`;
  }
  return where;
}

/**
 * Toolbar counts for the whole number list.
 * Search and column filters stay out. One scan of `base`.
 */
export function toolbarCountSql(): Prisma.Sql {
  return Prisma.sql`
    WITH ${baseCte}
    SELECT
      count(*) FILTER (WHERE activation = ${STATUS_BLOCKED})::int AS blocked,
      count(*) FILTER (WHERE unregistered)::int AS unregistered,
      count(*) FILTER (WHERE missing)::int AS missing
    FROM base
  `;
}

/** Stored DID provider, with Finenumbers shown as «Вручную». */
function sourceLabelSql(provider: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN lower(btrim(COALESCE(${provider}, ''))) = ${FINENUMBERS_PROVIDER_CODE}
        THEN ${GEOGRAPHY_MANUAL_SOURCE}
      ELSE btrim(COALESCE(${provider}, ''))
    END
  )`;
}

export function expensiveWhere(
  filters: ColumnFilters,
  excludeColumn?: string,
): Prisma.Sql {
  return whereFor(filters, "expensive", excludeColumn);
}

/** Same branches as geographyMatchKey. The number expression is already trimmed. */
export function geographyMatchKeySql(numberExpr: Prisma.Sql): Prisma.Sql {
  const digits = Prisma.sql`regexp_replace(${numberExpr}, '[^0-9]', '', 'g')`;
  return Prisma.sql`(
    CASE
      WHEN ${digits} ~ ${PSTN_ELEVEN_DIGIT} THEN 'p:' || substring(${digits} FROM 2)
      WHEN ${digits} ~ ${PSTN_TEN_DIGIT} THEN 'p:' || ${digits}
      WHEN ${digits} <> '' THEN 'd:' || ${digits}
      ELSE 'e:' || ${numberExpr}
    END
  )`;
}

const baseCte = Prisma.sql`
  did_generation AS (
    SELECT generation
    FROM geography_did_state
    WHERE id = 1
  ),
  endpoints AS (
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
  ),
  endpoint_keys AS (
    SELECT
      endpoints.*,
      ${geographyMatchKeySql(Prisma.sql`endpoints.number`)} AS match_key
    FROM endpoints
  ),
  did_rows AS (
    SELECT
      s."rowId" AS id,
      s."displayNumber" AS number,
      s."matchKey" AS match_key,
      s.provider AS provider
    FROM geography_did_sources s
    WHERE s.generation = (SELECT generation FROM did_generation)
  ),
  base_rows AS (
    SELECT
      e.id,
      e.number,
      e.client,
      e.capacity,
      e.supplier,
      e.category,
      e.activation,
      e.title,
      ${sourceLabelSql(Prisma.sql`d.provider`)} AS source,
      FALSE AS missing
    FROM endpoint_keys e
    LEFT JOIN did_rows d ON d.match_key = e.match_key
    UNION ALL
    SELECT
      d.id,
      d.number,
      '' AS client,
      '' AS capacity,
      '' AS supplier,
      '' AS category,
      ${STATUS_NOT_IN_RTU} AS activation,
      '' AS title,
      ${sourceLabelSql(Prisma.sql`d.provider`)} AS source,
      TRUE AS missing
    FROM did_rows d
    WHERE NOT EXISTS (
      SELECT 1
      FROM endpoint_keys e
      WHERE e.match_key = d.match_key
    )
  ),
  base AS (
    SELECT
      rows.*,
      (r.phone IS NOT NULL) AS unregistered
    FROM base_rows rows
    LEFT JOIN reg_current r
      ON r.phone = rows.number
     AND r.status = ${"Unregistered"}::"RegStatus"
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
        k.source,
        k.missing,
        k.unregistered,
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
      source,
      missing,
      unregistered,
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

export function pageFacetSql(column: RtuColumn, cheap: Prisma.Sql): Prisma.Sql {
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
  column: RtuColumn,
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
/** Operator and geography for ids whose numbers are already known. */
export function pstnLabelsForNumbersSql(
  rows: readonly { id: string; number: string }[],
): Prisma.Sql {
  const values = Prisma.join(
    rows.map((row) => Prisma.sql`(${row.id}::text, ${row.number}::text)`),
  );
  return Prisma.sql`
    WITH src AS (
      SELECT id, number
      FROM (VALUES ${values}) AS v(id, number)
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
