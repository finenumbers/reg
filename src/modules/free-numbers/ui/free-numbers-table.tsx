"use client";

import type { ColumnFilters } from "@/components/column-filters";
import { CatalogDigitCell } from "@/modules/did-catalog/ui/catalog-digit-cell";
import { CatalogNumbersTable } from "@/modules/did-catalog/ui/catalog-numbers-table";
import { buildFreeNumbersFacetsUrl } from "@/modules/free-numbers/api-client";
import {
  AMOUNT_COLUMNS,
  FREE_NUMBER_COLUMNS,
  FREE_NUMBER_HEADERS,
  type FreeNumberColumn,
} from "@/modules/free-numbers/columns";
import {
  displayFreeNumberCell,
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
  return displayFreeNumberCell(column, row[column] ?? "");
}

export function FreeNumbersTable(props: Props) {
  return (
    <CatalogNumbersTable
      {...props}
      columns={FREE_NUMBER_COLUMNS}
      headers={FREE_NUMBER_HEADERS}
      numberColumn="number"
      rightColumns={[...AMOUNT_COLUMNS]}
      cellText={cellText}
      formatValue={displayFreeNumberFacet}
      buildFacetsUrl={buildFreeNumbersFacetsUrl}
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
