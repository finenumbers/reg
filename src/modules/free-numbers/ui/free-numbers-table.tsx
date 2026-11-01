"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColumnFilterDropdown, type ColumnFilters } from "@/components/column-filters";
import { HighlightText } from "@/components/highlight-text";
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

export function FreeNumbersTable({
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
}: Props) {
  const showEmpty = !loading && data.length === 0;
  const colCount = FREE_NUMBER_COLUMNS.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {FREE_NUMBER_COLUMNS.map((column) => (
            <TableHead key={column} className="font-medium">
              <ColumnFilterDropdown
                column={column}
                header={FREE_NUMBER_HEADERS[column]}
                open={openColumn === column}
                selected={filters[column] ?? []}
                filters={filters}
                formatValue={(value) => displayFreeNumberFacet(column, value)}
                buildFacetsUrl={({ column: col, filters: next, q }) =>
                  buildFreeNumbersFacetsUrl({
                    column: col,
                    filters: next,
                    phoneQ,
                    q,
                  })
                }
                onToggle={() => onOpenColumnChange(openColumn === column ? null : column)}
                onChange={(values) => onColumnFilterChange(column, values)}
                onClear={() => onColumnFilterChange(column, [])}
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={colCount} className="text-muted-foreground h-24">
              Загрузка…
            </TableCell>
          </TableRow>
        ) : showEmpty ? (
          <TableRow>
            <TableCell colSpan={colCount} className="text-muted-foreground h-24">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row) => (
            <TableRow key={row.id}>
              {FREE_NUMBER_COLUMNS.map((column) => (
                <TableCell
                  key={`${row.id}-${column}`}
                  className={
                    column === "number_local"
                      ? "font-bold text-black dark:text-white"
                      : undefined
                  }
                >
                  {column === "number_local" ? (
                    <HighlightText text={cellText(row, column)} query={phoneQ} />
                  ) : (
                    cellText(row, column)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function cellText(row: FreeNumberRow, column: FreeNumberColumn): string {
  return row[column] ?? "";
}
