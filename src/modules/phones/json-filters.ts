/**
 * Prisma where fragments for JSON `data` multi-select column filters.
 * AND across columns, OR within a column; `__empty__` → equals "".
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";

type JsonDataWhere = {
  data?: Prisma.JsonFilter<"PhoneEndpoint"> | Prisma.JsonFilter<"PhoneGateway">;
  OR?: JsonDataWhere[];
};

function jsonColumnOr(column: string, values: string[]): JsonDataWhere | null {
  if (values.length === 0) return null;
  const ors: JsonDataWhere[] = values.map((raw) => ({
    data: {
      path: [column],
      equals: raw === EMPTY_FILTER_TOKEN ? "" : raw,
    },
  }));
  if (ors.length === 1) return ors[0]!;
  return { OR: ors };
}

export function applyJsonColumnFilters<T extends object>(
  base: T,
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): T {
  const extras: object[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (opts.excludeColumn && column === opts.excludeColumn) continue;
    if (!values?.length) continue;
    const clause = jsonColumnOr(column, values);
    if (clause) extras.push(clause);
  }
  if (extras.length === 0) return base;
  return { AND: [base, ...extras] } as T;
}
