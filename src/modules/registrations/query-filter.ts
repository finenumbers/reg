/**
 * Shared list/facet predicates for registrations toolbar + column filters.
 * Pure — no Prisma / React.
 */

import {
  cellToFilterToken,
  type ColumnFilters,
} from "@/components/column-filters/types";
import type { RegistrationListItem } from "@/modules/registrations/types";
import { formatEndpoint } from "@/modules/registrations/ui-format";

export type RegistrationQuery = {
  filters?: ColumnFilters;
  phoneQ?: string;
  unregisteredOnly?: boolean;
  excludeColumn?: string;
};

export function columnCellValue(
  row: RegistrationListItem,
  column: string,
): string {
  switch (column) {
    case "phone":
      return row.phone;
    case "description":
      return row.description ?? "";
    case "status":
      return row.status;
    case "endpoint":
      return formatEndpoint(row.ip, row.port);
    case "country":
      return row.country ?? "";
    case "city":
      return row.city ?? "";
    case "isp":
      return row.isp ?? "";
    case "lastChangedAt":
      return row.lastChangedAt ?? "";
    case "lastSeenAt":
      return row.lastSeenAt ?? "";
    default:
      return "";
  }
}

function matchesColumnFilter(
  row: RegistrationListItem,
  column: string,
  values: string[],
): boolean {
  if (values.length === 0) return true;
  const token = cellToFilterToken(columnCellValue(row, column));
  return values.includes(token);
}

function applyColumnFilters(
  rows: RegistrationListItem[],
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): RegistrationListItem[] {
  const entries = Object.entries(filters).filter(
    ([col, values]) =>
      values.length > 0 &&
      (!opts.excludeColumn || col !== opts.excludeColumn),
  );
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([col, values]) => matchesColumnFilter(row, col, values)),
  );
}

export function matchesPhoneQ(
  row: RegistrationListItem,
  phoneQ: string,
): boolean {
  if (!phoneQ) return true;
  return row.phone.toLowerCase().includes(phoneQ.toLowerCase());
}

/** Column filters + phoneQ + unregisteredOnly. Used by list and facets. */
export function applyRegistrationQuery(
  rows: RegistrationListItem[],
  query: RegistrationQuery = {},
): RegistrationListItem[] {
  const phoneQ = (query.phoneQ ?? "").trim();
  return applyColumnFilters(rows, query.filters ?? {}, {
    excludeColumn: query.excludeColumn,
  })
    .filter((row) => matchesPhoneQ(row, phoneQ))
    .filter((row) => !query.unregisteredOnly || row.status === "Unregistered");
}
