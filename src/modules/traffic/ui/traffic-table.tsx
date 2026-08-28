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
import { CDR_PHONE_COLUMNS } from "@/modules/traffic/columns";
import { buildTrafficFacetsUrl } from "@/modules/traffic/api-client";
import type { TrafficListItem } from "@/modules/traffic/service";

const PHONE_SET = new Set<string>(CDR_PHONE_COLUMNS);

type Props = {
  headers: string[];
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

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h} className="text-sm font-medium">
              <ColumnFilterDropdown
                column={h}
                header={h}
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
                return (
                  <TableCell key={h} className="whitespace-nowrap">
                    {PHONE_SET.has(h) ? (
                      <HighlightText text={raw} query={phoneQ} />
                    ) : (
                      raw
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
