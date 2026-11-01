"use client";

import type { ColumnFilters } from "@/components/column-filters";
import { CatalogNumbersTable } from "@/modules/did-catalog/ui/catalog-numbers-table";
import { displayFreeNumberFacet } from "@/modules/free-numbers/format";
import { buildPurchasedNumbersFacetsUrl } from "@/modules/purchased-numbers/api-client";
import {
  PURCHASED_NUMBER_COLUMNS,
  PURCHASED_NUMBER_HEADERS,
  type PurchasedNumberColumn,
} from "@/modules/purchased-numbers/columns";
import type { PurchasedNumberRow } from "@/modules/purchased-numbers/format";
import {
  PURCHASED_ROW_CLASS,
  purchasedRowTone,
} from "@/modules/purchased-numbers/row-tone";

type Props = {
  data: PurchasedNumberRow[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

function cellText(row: PurchasedNumberRow, column: PurchasedNumberColumn): string {
  return row[column] ?? "";
}

export function PurchasedNumbersTable(props: Props) {
  return (
    <CatalogNumbersTable
      {...props}
      columns={PURCHASED_NUMBER_COLUMNS}
      headers={PURCHASED_NUMBER_HEADERS}
      numberColumn="number_local"
      cellText={cellText}
      formatValue={displayFreeNumberFacet}
      buildFacetsUrl={buildPurchasedNumbersFacetsUrl}
      rowClassName={(row) => PURCHASED_ROW_CLASS[purchasedRowTone(row)]}
    />
  );
}
