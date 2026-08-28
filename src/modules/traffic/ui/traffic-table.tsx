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
import { HighlightText } from "@/components/highlight-text";
import {
  CDR_PHONE_COLUMNS,
  TRAFFIC_BOLD_COLUMNS,
} from "@/modules/traffic/columns";
import { buildTrafficFacetsUrl } from "@/modules/traffic/api-client";
import type { TrafficListItem } from "@/modules/traffic/service";
import {
  displayTrafficFacet,
  formatTrafficCell,
} from "@/modules/traffic/ui-format";

const DEFAULT_HIGHLIGHT = new Set<string>(CDR_PHONE_COLUMNS);
const DEFAULT_BOLD = new Set<string>(TRAFFIC_BOLD_COLUMNS);

type Props = {
  headers: string[];
  headerLabels?: Record<string, string>;
  highlightColumns?: readonly string[];
  data: TrafficListItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

export function TrafficTable({
  headers,
  headerLabels,
  highlightColumns,
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
  const colCount = Math.max(headers.length, 1);
  const highlightSet = highlightColumns
    ? new Set(highlightColumns)
    : DEFAULT_HIGHLIGHT;

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h} className="text-sm font-medium">
              <ColumnFilterDropdown
                column={h}
                header={headerLabels?.[h] ?? h}
                open={openColumn === h}
                selected={filters[h] ?? []}
                filters={filters}
                buildFacetsUrl={({ column, filters: f, q }) =>
                  buildTrafficFacetsUrl({
                    column,
                    filters: f,
                    phoneQ,
                    q,
                  })
                }
                formatValue={(value) => displayTrafficFacet(h, value)}
                onToggle={() =>
                  onOpenColumnChange(openColumn === h ? null : h)
                }
                onChange={(values) => onColumnFilterChange(h, values)}
                onClear={() => onColumnFilterChange(h, [])}
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell
              colSpan={colCount}
              className="h-24 text-sm text-muted-foreground"
            >
              Загрузка…
            </TableCell>
          </TableRow>
        ) : showEmpty ? (
          <TableRow>
            <TableCell
              colSpan={colCount}
              className="h-24 text-sm text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row) => (
            <TableRow key={row.id}>
              {headers.map((h) => {
                const raw = row.data[h] ?? "";
                const shown = formatTrafficCell(h, raw);
                return (
                  <TableCell
                    key={h}
                    className={
                      DEFAULT_BOLD.has(h)
                        ? "whitespace-nowrap font-bold"
                        : "whitespace-nowrap"
                    }
                  >
                    {highlightSet.has(h) ? (
                      <HighlightText text={shown} query={phoneQ} />
                    ) : (
                      shown
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
