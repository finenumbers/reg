"use client";

import type { ColumnFilters } from "@/components/column-filters";
import { CatalogDigitCell } from "@/modules/did-catalog/ui/catalog-digit-cell";
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
      cellClassName={(row, column) =>
        column === "abc" && row.e164
          ? "text-left font-bold tabular-nums text-black dark:text-white"
          : undefined
      }
      renderCell={(row, column) =>
        column === "abc" || column === "number" ? (
          <CatalogDigitCell
            e164={row.e164}
            abc={row.abc}
            number={row.number}
            column={column}
            phoneQ={props.phoneQ}
          />
        ) : (
          cellText(row, column)
        )
      }
    />
  );
}
