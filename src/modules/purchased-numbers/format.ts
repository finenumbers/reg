/**
 * Display for purchased-number cells and facet menus.
 * The stored string stays the filter token.
 */

import { formatAmountCell, formatStoredAmount } from "@/lib/amount-format";
import { displayFacetValue } from "@/components/column-filters/types";
import {
  AMOUNT_COLUMNS,
  type PurchasedNumberColumn,
} from "@/modules/purchased-numbers/columns";

export type PurchasedNumberRow = {
  id: string;
  provider: string;
  abc: string;
  number: string;
  category: string;
  city: string;
  region: string;
  client: string;
  mask: string;
  maskType: string;
  purchase: string;
  premium: string;
  operator: string;
  geography: string;
};

export type ListPurchasedNumbersResult = {
  items: PurchasedNumberRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function displayPurchasedNumberCell(
  column: PurchasedNumberColumn,
  value: string,
): string {
  if (AMOUNT_COLUMNS.has(column)) return formatAmountCell(value);
  return value;
}

export function displayPurchasedNumberFacet(column: string, value: string): string {
  if (AMOUNT_COLUMNS.has(column as PurchasedNumberColumn)) return formatStoredAmount(value);
  return displayFacetValue(value);
}
