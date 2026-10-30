/**
 * Prisma where fragments for JSON `data` multi-select column filters.
 * AND across columns, OR within a column; `__empty__` → equals "".
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";
import {
  PREMIUM_CAPACITY,
  TERM_CAPACITY_FIELD,
} from "@/modules/phones/capacity";

type JsonDataWhere = {
  data?: Prisma.JsonFilter<"PhoneEndpoint"> | Prisma.JsonFilter<"PhoneGateway">;
  OR?: JsonDataWhere[];
};

function jsonEquals(column: string, value: string): JsonDataWhere {
  return {
    data: {
      path: [column],
      equals: value === EMPTY_FILTER_TOKEN ? "" : value,
    },
  };
}

/**
 * «Премиум» is the screen label for a blank «ТЕРМ. емкость». The JSON cell
 * stays "". Selecting «Премиум» matches that blank and a literal «Премиум».
 */
function jsonColumnOr(column: string, values: string[]): JsonDataWhere | null {
  if (values.length === 0) return null;
  const ors: JsonDataWhere[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (
      column === TERM_CAPACITY_FIELD &&
      (raw === PREMIUM_CAPACITY || raw === EMPTY_FILTER_TOKEN)
    ) {
      if (seen.has("")) continue;
      seen.add("");
      seen.add(PREMIUM_CAPACITY);
      ors.push(jsonEquals(column, ""));
      ors.push(jsonEquals(column, PREMIUM_CAPACITY));
      continue;
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    ors.push(jsonEquals(column, raw));
  }
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
