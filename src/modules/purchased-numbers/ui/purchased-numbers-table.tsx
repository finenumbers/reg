"use client";

import type { ColumnFilters } from "@/components/column-filters";
import { CatalogNumbersTable } from "@/modules/did-catalog/ui/catalog-numbers-table";
import { buildPurchasedNumbersFacetsUrl } from "@/modules/purchased-numbers/api-client";
import {
  AMOUNT_COLUMNS,
  PURCHASED_NUMBER_COLUMNS,
  PURCHASED_NUMBER_HEADERS,
  type PurchasedNumberColumn,
} from "@/modules/purchased-numbers/columns";
import {
  displayPurchasedNumberCell,
  displayPurchasedNumberFacet,
  type PurchasedNumberRow,
} from "@/modules/purchased-numbers/format";

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
  return displayPurchasedNumberCell(column, row[column] ?? "");
}

export function PurchasedNumbersTable(props: Props) {
  return (
    <CatalogNumbersTable
      {...props}
      columns={PURCHASED_NUMBER_COLUMNS}
      headers={PURCHASED_NUMBER_HEADERS}
      numberColumn="number"
      rightColumns={[...AMOUNT_COLUMNS]}
      cellText={cellText}
      formatValue={displayPurchasedNumberFacet}
      buildFacetsUrl={buildPurchasedNumbersFacetsUrl}
    />
  );
}
