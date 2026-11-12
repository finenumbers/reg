"use client";

import type { ColumnFilters } from "@/components/column-filters";
import { CatalogNumbersTable } from "@/modules/did-catalog/ui/catalog-numbers-table";
import { buildFreeNumbersFacetsUrl } from "@/modules/free-numbers/api-client";
import {
  FREE_NUMBER_COLUMNS,
  FREE_NUMBER_HEADERS,
  type FreeNumberColumn,
} from "@/modules/free-numbers/columns";
import {
  displayFreeNumberFacet,
  type FreeNumberRow,
} from "@/modules/free-numbers/format";

type Props = {
  data: FreeNumberRow[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

function cellText(row: FreeNumberRow, column: FreeNumberColumn): string {
  return row[column] ?? "";
}

export function FreeNumbersTable(props: Props) {
  return (
    <CatalogNumbersTable
      {...props}
      columns={FREE_NUMBER_COLUMNS}
      headers={FREE_NUMBER_HEADERS}
      numberColumn="number_local"
      rightColumns={["mask_purchase", "premium"]}
      cellText={cellText}
      formatValue={displayFreeNumberFacet}
      buildFacetsUrl={buildFreeNumbersFacetsUrl}
    />
  );
}
