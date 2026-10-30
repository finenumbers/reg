"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ColumnFilterDropdown,
  type ColumnFilters,
} from "@/components/column-filters";
import { cn } from "@/lib/utils";
import { buildNumberGeographyFacetsUrl } from "@/modules/number-geography/api-client";
import {
  NUMBER_GEOGRAPHY_COLUMNS,
  NUMBER_GEOGRAPHY_HEADERS,
  type NumberGeographyColumn,
} from "@/modules/number-geography/columns";
import type { NumberGeographyItem } from "@/modules/number-geography/types";

type Props = {
  data: NumberGeographyItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

function cellText(row: NumberGeographyItem, column: NumberGeographyColumn): string {
  return row[column] ?? "";
}

export function NumberGeographyTable({
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
}: Props) {
  const showEmpty = !loading && data.length === 0;
  const colCount = NUMBER_GEOGRAPHY_COLUMNS.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {NUMBER_GEOGRAPHY_COLUMNS.map((column) => (
            <TableHead key={column} className="font-medium">
              <ColumnFilterDropdown
                column={column}
                header={NUMBER_GEOGRAPHY_HEADERS[column]}
                open={openColumn === column}
                selected={filters[column] ?? []}
                filters={filters}
                buildFacetsUrl={({ column: col, filters: next, q }) =>
                  buildNumberGeographyFacetsUrl({
                    column: col,
                    filters: next,
                    q,
                  })
                }
                onToggle={() =>
                  onOpenColumnChange(openColumn === column ? null : column)
                }
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
            <TableRow
              key={row.id}
              className={cn(
                row.cityAlert && "bg-destructive/10 hover:bg-destructive/15",
              )}
            >
              {NUMBER_GEOGRAPHY_COLUMNS.map((column) => (
                <TableCell key={`${row.id}-${column}`}>
                  {cellText(row, column)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
