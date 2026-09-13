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
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  buildRegsFacetsUrl,
  displayFacetForColumn,
  formatEndpoint,
  formatTimestamp,
  REG_COLUMN_HEADERS,
  REG_COLUMN_ORDER,
} from "@/modules/registrations/ui-format";
import { RegStatusBadge } from "@/modules/registrations/ui/reg-status-badge";
import { cn } from "@/lib/utils";

type Props = {
  data: RegistrationListItem[];
  loading?: boolean;
  emptyMessage?: string;
  selectedPhone?: string | null;
  filters: ColumnFilters;
  phoneQ?: string;
  unregisteredOnly?: boolean;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  onRowClick?: (row: RegistrationListItem) => void;
};

export function RegsTable({
  data,
  loading = false,
  emptyMessage = "Регистрации не найдены.",
  selectedPhone = null,
  filters,
  phoneQ = "",
  unregisteredOnly = false,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  onRowClick,
}: Props) {
  const { timeZone } = useDisplayTimezone();
  const showEmpty = !loading && data.length === 0;
  const colCount = REG_COLUMN_ORDER.length;

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {REG_COLUMN_ORDER.map((id) => (
            <TableHead key={id} className="text-sm font-medium">
              <ColumnFilterDropdown
                column={id}
                header={REG_COLUMN_HEADERS[id]}
                open={openColumn === id}
                selected={filters[id] ?? []}
                filters={filters}
                buildFacetsUrl={({ column, filters: f, q }) =>
                  buildRegsFacetsUrl({
                    column,
                    filters: f,
                    phoneQ,
                    unregisteredOnly,
                    q,
                  })
                }
                formatValue={(value) =>
                  displayFacetForColumn(id, value, timeZone)
                }
                onToggle={() =>
                  onOpenColumnChange(openColumn === id ? null : id)
                }
                onChange={(values) => onColumnFilterChange(id, values)}
                onClear={() => onColumnFilterChange(id, [])}
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
              Загрузка регистраций…
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
          data.map((row) => {
            const selected = selectedPhone === row.phone;
            return (
              <TableRow
                key={row.phone}
                data-state={selected ? "selected" : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  row.status === "Unregistered"
                    ? "bg-destructive/10 hover:bg-destructive/15 data-[state=selected]:bg-destructive/20"
                    : selected && "bg-muted/60",
                )}
                onClick={() => onRowClick?.(row)}
              >
                {/* Cell order must match REG_COLUMN_ORDER */}
                <TableCell className="text-sm">
                  <span className="text-sm tabular-nums">
                    <HighlightText text={row.phone} query={phoneQ} />
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {row.channelality ? (
                    row.channelality
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {row.description ? (
                    row.description
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <RegStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-sm">
                  <span className="text-sm text-muted-foreground">
                    {formatEndpoint(row.ip, row.port)}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {row.country ? (
                    row.country
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {row.city ? (
                    row.city
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {row.isp ? (
                    row.isp
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {formatTimestamp(row.lastChangedAt, timeZone)}
                </TableCell>
                <TableCell className="text-sm">
                  {formatTimestamp(row.lastSeenAt, timeZone)}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
