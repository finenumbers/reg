/**
 * Display for free-number cells and facet menus.
 * The stored string stays the filter token.
 */

import { formatAmountCell, formatStoredAmount } from "@/lib/amount-format";
import { displayFacetValue } from "@/components/column-filters/types";
import {
  AMOUNT_COLUMNS,
  type FreeNumberColumn,
} from "@/modules/free-numbers/columns";

export type FreeNumberRow = {
  id: string;
  provider: string;
  abc: string;
  number: string;
  category: string;
  city: string;
  region: string;
  mask: string;
  maskType: string;
  incomingPurchase: string;
  incomingPeriod: string;
  purchase: string;
  premium: string;
  operator: string;
  geography: string;
  /** National digits. Empty rows stay plain text. */
  e164: string;
};

export type ListFreeNumbersResult = {
  items: FreeNumberRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function displayFreeNumberCell(column: FreeNumberColumn, value: string): string {
  if (AMOUNT_COLUMNS.has(column)) return formatAmountCell(value);
  return value;
}

export function displayFreeNumberFacet(column: string, value: string): string {
  if (AMOUNT_COLUMNS.has(column as FreeNumberColumn)) return formatStoredAmount(value);
  return displayFacetValue(value);
}
