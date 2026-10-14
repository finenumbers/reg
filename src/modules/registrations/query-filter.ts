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

const GEO_FILTER_COLUMNS = new Set(["country", "city", "isp"]);

function isPendingGeo(row: RegistrationListItem, column: string): boolean {
  return row.geoPending === true && GEO_FILTER_COLUMNS.has(column);
}

export function columnCellValue(
  row: RegistrationListItem,
  column: string,
): string {
  switch (column) {
    case "phone":
      return row.phone;
    case "channelality":
      return row.channelality ?? "";
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
  if (isPendingGeo(row, column)) return false;
  const token = cellToFilterToken(columnCellValue(row, column));
  return values.includes(token);
}

/** Facet token, or null while country/city/isp are still unknown. */
export function registrationFacetToken(
  row: RegistrationListItem,
  column: string,
): string | null {
  if (isPendingGeo(row, column)) return null;
  return cellToFilterToken(columnCellValue(row, column));
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

/** Global Unregistered bucket — ignores list filters. */
export function countUnregisteredRows(
  rows: readonly Pick<RegistrationListItem, "status">[],
): number {
  return rows.reduce(
    (n, row) => (row.status === "Unregistered" ? n + 1 : n),
    0,
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
