"use client";

import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";

type Props<T extends { id: string }, C extends string> = {
  columns: readonly C[];
  headers: Record<C, string>;
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  numberColumn: C;
  rightColumns?: readonly C[];
  cellText: (row: T, column: C) => string;
  formatValue: (column: string, value: string) => string;
  buildFacetsUrl: (opts: {
    column: string;
    filters?: ColumnFilters;
    phoneQ?: string;
    q?: string;
  }) => string;
  rowClassName?: (row: T) => string;
  cellClassName?: (row: T, column: C) => string | undefined;
  renderCell?: (row: T, column: C) => ReactNode;
};

export function CatalogNumbersTable<T extends { id: string }, C extends string>({
  columns,
  headers,
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  numberColumn,
  rightColumns,
  cellText,
  formatValue,
  buildFacetsUrl,
  rowClassName,
  cellClassName,
  renderCell,
}: Props<T, C>) {
  const showEmpty = !loading && data.length === 0;
  const colCount = columns.length;
  const right = new Set<C>(rightColumns ?? []);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column}
              className={cn(
                "font-medium",
                (column === numberColumn || right.has(column)) && "text-right",
              )}
            >
              <ColumnFilterDropdown
                column={column}
                header={headers[column]}
                open={openColumn === column}
                selected={filters[column] ?? []}
                filters={filters}
                formatValue={(value) => formatValue(column, value)}
                buildFacetsUrl={({ column: col, filters: next, q }) =>
                  buildFacetsUrl({
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
            <TableRow key={row.id} className={rowClassName?.(row) || undefined}>
              {columns.map((column) => (
                <TableCell
                  key={`${row.id}-${column}`}
                  className={cn(
                    column === numberColumn &&
                      "text-right font-bold text-black dark:text-white",
                    right.has(column) && "text-right tabular-nums",
                    cellClassName?.(row, column),
                  )}
                >
                  {renderCell ? (
                    renderCell(row, column)
                  ) : column === numberColumn ? (
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
