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
import { buildAntifraudFacetsUrl } from "@/modules/antifraud/api-client";
import {
  RADIUS_FACET_COLUMNS,
  RADIUS_LABELS,
  RADIUS_PHONE_COLUMNS,
  type RadiusColumn,
} from "@/modules/antifraud/columns";
import type { RadiusListItem } from "@/modules/antifraud/service";
import { cn } from "@/lib/utils";
import {
  nextTimeSort,
  timeSortChevron,
  type TimeSort,
} from "@/modules/traffic/traffic-sort";

const FACETS = new Set<string>(RADIUS_FACET_COLUMNS);
const PHONES = new Set<string>(RADIUS_PHONE_COLUMNS);

type Props = {
  data: RadiusListItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  month: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  timeSort: TimeSort | null;
  onTimeSortChange: (next: TimeSort | null) => void;
};

function cell(row: RadiusListItem, column: RadiusColumn): string {
  return row[column] ?? "";
}

export function AntifraudTable({
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  month,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  timeSort,
  onTimeSortChange,
}: Props) {
  const headers = Object.keys(RADIUS_LABELS) as RadiusColumn[];
  const colCount = headers.length;
  const showEmpty = !loading && data.length === 0;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header) => (
            <TableHead key={header} className="font-medium">
              {header === "time" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => onTimeSortChange(nextTimeSort(timeSort))}
                >
                  {RADIUS_LABELS.time}
                  <span aria-hidden>{timeSortChevron(timeSort)}</span>
                </button>
              ) : FACETS.has(header) ? (
                <ColumnFilterDropdown
                  column={header}
                  header={RADIUS_LABELS[header]}
                  open={openColumn === header}
                  selected={filters[header] ?? []}
                  filters={filters}
                  buildFacetsUrl={({ column, filters: nextFilters, q }) =>
                    buildAntifraudFacetsUrl({
                      column,
                      filters: nextFilters,
                      phoneQ,
                      month,
                      q,
                    })
                  }
                  onToggle={() =>
                    onOpenColumnChange(openColumn === header ? null : header)
                  }
                  onChange={(values) => onColumnFilterChange(header, values)}
                  onClear={() => onColumnFilterChange(header, [])}
                />
              ) : (
                RADIUS_LABELS[header]
              )}
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
              {headers.map((header) => {
                const value = cell(row, header);
                return (
                  <TableCell key={header} className={cn("whitespace-nowrap")}>
                    {PHONES.has(header) ? (
                      <HighlightText text={value} query={phoneQ} />
                    ) : (
                      value
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
