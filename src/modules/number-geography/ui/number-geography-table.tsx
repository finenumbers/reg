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
import { buildNumberGeographyFacetsUrl } from "@/modules/number-geography/api-client";
import {
  NUMBER_GEOGRAPHY_COLUMNS,
  NUMBER_GEOGRAPHY_HEADERS,
  type NumberGeographyColumn,
} from "@/modules/number-geography/columns";
import {
  geographyRowTone,
  type GeographyRowTone,
} from "@/modules/number-geography/row-tone";
import type { NumberGeographyItem } from "@/modules/number-geography/types";
import { STATUS_ACTIVE, STATUS_BLOCKED } from "@/modules/phones/types";

type Props = {
  data: NumberGeographyItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  lookupFailed?: ReadonlySet<string>;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  onActivation?: (row: NumberGeographyItem) => void;
};

const ROW_TONE_CLASS: Record<GeographyRowTone, string> = {
  blocked: "bg-black text-white hover:bg-black hover:text-white",
  red: "bg-destructive/10 hover:bg-destructive/15",
  yellow: "bg-amber-400/25 hover:bg-amber-400/35",
  blue: "bg-sky-500/15 hover:bg-sky-500/25",
  none: "",
};

function cellText(row: NumberGeographyItem, column: NumberGeographyColumn): string {
  return row[column] ?? "";
}

export function NumberGeographyTable({
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  blockedOnly = false,
  lookupFailed,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  onActivation,
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
                    phoneQ,
                    blockedOnly,
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
          data.map((row) => {
            const tone = geographyRowTone(row, {
              surface: "screen",
              lookupFailed: lookupFailed?.has(row.id) === true,
            });
            return (
              <TableRow key={row.id} className={ROW_TONE_CLASS[tone]}>
                {NUMBER_GEOGRAPHY_COLUMNS.map((column) => (
                  <TableCell
                    key={`${row.id}-${column}`}
                    className={
                      column === "number"
                        ? tone === "blocked"
                          ? "font-bold text-white"
                          : "font-bold text-black dark:text-white"
                        : undefined
                    }
                  >
                    {column === "number" ? (
                      <HighlightText text={cellText(row, column)} query={phoneQ} />
                    ) : column === "activation" &&
                      onActivation &&
                      (cellText(row, column) === STATUS_ACTIVE ||
                        cellText(row, column) === STATUS_BLOCKED) ? (
                      <button
                        type="button"
                        className="text-inherit underline underline-offset-2"
                        onClick={() => onActivation(row)}
                      >
                        {cellText(row, column)}
                      </button>
                    ) : (
                      cellText(row, column)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
