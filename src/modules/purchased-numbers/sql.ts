/**
 * Read-only SQL for purchased_numbers. Column names come from the allowlist.
 * Filter values are bound parameters.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  type ColumnFilters,
} from "@/components/column-filters/types";
import {
  PURCHASED_NUMBER_COLUMNS,
  isAmountColumn,
  type PurchasedNumberColumn,
} from "@/modules/purchased-numbers/columns";

export type PurchasedNumberCursor = {
  abc: string;
  number: string;
  id: string;
};

function columnRef(column: PurchasedNumberColumn): Prisma.Sql {
  switch (column) {
    case "provider":
      return Prisma.sql`provider`;
    case "abc":
      return Prisma.sql`abc`;
    case "number":
      return Prisma.sql`"number"`;
    case "category":
      return Prisma.sql`category`;
    case "city":
      return Prisma.sql`city`;
    case "region":
      return Prisma.sql`region`;
    case "client":
      return Prisma.sql`client`;
    case "mask":
      return Prisma.sql`mask`;
    case "maskType":
      return Prisma.sql`"maskType"`;
    case "purchase":
      return Prisma.sql`purchase`;
    case "premium":
      return Prisma.sql`premium`;
    case "operator":
      return Prisma.sql`operator`;
    case "geography":
      return Prisma.sql`geography`;
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Bound IN-list plus an empty-cell disjunct. Values never enter the SQL text. */
export function filterMatchSql(column: PurchasedNumberColumn, values: string[]): Prisma.Sql {
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

/** Other-column filters plus a substring of «Номер». The open menu column is left out. */
export function purchasedNumberWhere(
  filters: ColumnFilters,
  phoneQ: string | undefined,
  excludeColumn?: PurchasedNumberColumn,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  for (const column of PURCHASED_NUMBER_COLUMNS) {
    if (column === excludeColumn) continue;
    const values = filters[column];
    if (!values?.length) continue;
    clauses.push(filterMatchSql(column, values));
  }
  const phone = phoneQ?.trim() ?? "";
  if (phone) {
    clauses.push(Prisma.sql`"number" ILIKE ${likePattern(phone)} ESCAPE '\\'`);
  }
  return andWhere(clauses);
}

function facetValueWhere(column: PurchasedNumberColumn, q: string): Prisma.Sql | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const expr = columnRef(column);
  const parts: Prisma.Sql[] = [
    Prisma.sql`${expr} ILIKE ${likePattern(trimmed)} ESCAPE '\\'`,
  ];
  if (isAmountColumn(column)) {
    const compact = trimmed.replace(/[\s\u00a0]/g, "");
    if (compact) {
      parts.push(
        Prisma.sql`replace(replace(${expr}, ' ', ''), chr(160), '') ILIKE ${likePattern(compact)} ESCAPE '\\'`,
      );
    }
  }
  if (facetQueryMatchesEmptyLabel(trimmed)) {
    parts.push(Prisma.sql`${expr} = ''`);
  }
  if (parts.length === 1) return parts[0]!;
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

const ROW_SELECT = Prisma.sql`
  id,
  provider,
  abc,
  "number",
  category,
  city,
  region,
  client,
  mask,
  "maskType",
  purchase,
  premium,
  operator,
  geography
`;

export function purchasedNumberListSql(
  where: Prisma.Sql,
  limit: number,
  offset: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT ${ROW_SELECT}
    FROM purchased_numbers
    WHERE ${where}
    ORDER BY abc ASC, "number" ASC, id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export function purchasedNumberCountSql(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS count
    FROM purchased_numbers
    WHERE ${where}
  `;
}

/** Next page after the last written row. The first page has no cursor. */
export function purchasedNumberKeysetSql(
  where: Prisma.Sql,
  cursor: PurchasedNumberCursor | null,
  limit: number,
): Prisma.Sql {
  const after = cursor
    ? Prisma.sql`AND (
        abc > ${cursor.abc}
        OR (abc = ${cursor.abc} AND "number" > ${cursor.number})
        OR (abc = ${cursor.abc} AND "number" = ${cursor.number} AND id > ${cursor.id})
      )`
    : Prisma.empty;
  return Prisma.sql`
    SELECT ${ROW_SELECT}
    FROM purchased_numbers
    WHERE ${where}
    ${after}
    ORDER BY abc ASC, "number" ASC, id ASC
    LIMIT ${limit}
  `;
}

/** One grouped column. The value search is applied before the limit. */
export function purchasedNumberFacetSql(
  column: PurchasedNumberColumn,
  where: Prisma.Sql,
  q: string,
  limit: number,
): Prisma.Sql {
  const expr = columnRef(column);
  const match = facetValueWhere(column, q);
  const valueWhere = match ? Prisma.sql`AND ${match}` : Prisma.empty;
  return Prisma.sql`
    SELECT ${expr} AS value, count(*)::int AS count
    FROM purchased_numbers
    WHERE ${where}
    ${valueWhere}
    GROUP BY 1
    ORDER BY count(*) DESC, value ASC
    LIMIT ${limit}
  `;
}
