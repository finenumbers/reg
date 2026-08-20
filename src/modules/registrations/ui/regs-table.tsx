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
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  buildRegsFacetsUrl,
  displayFacetForColumn,
  formatEndpoint,
  formatTimestamp,
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
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  onRowClick,
}: Props) {
  const showEmpty = !loading && data.length === 0;
  const colCount = 9;

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {(
            [
              { id: "phone", header: "Телефон" },
              { id: "description", header: "Описание" },
              { id: "status", header: "Статус" },
              { id: "endpoint", header: "Endpoint" },
              { id: "country", header: "Страна" },
              { id: "city", header: "Город" },
              { id: "isp", header: "Оператор связи" },
              { id: "lastChangedAt", header: "Последнее изменение" },
              { id: "lastSeenAt", header: "Обновление" },
            ] as const
          ).map((col) => (
            <TableHead key={col.id} className="text-sm font-medium">
              <ColumnFilterDropdown
                column={col.id}
                header={col.header}
                open={openColumn === col.id}
                selected={filters[col.id] ?? []}
                filters={filters}
                buildFacetsUrl={({ column, filters: f, q }) =>
                  buildRegsFacetsUrl({ column, filters: f, phoneQ, q })
                }
                formatValue={(value) => displayFacetForColumn(col.id, value)}
                onToggle={() =>
                  onOpenColumnChange(openColumn === col.id ? null : col.id)
                }
                onChange={(values) => onColumnFilterChange(col.id, values)}
                onClear={() => onColumnFilterChange(col.id, [])}
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
                  selected && "bg-muted/60",
                )}
                onClick={() => onRowClick?.(row)}
              >
                <TableCell className="text-sm">
                  <span className="text-sm tabular-nums">
                    <HighlightText text={row.phone} query={phoneQ} />
                  </span>
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
                  {formatTimestamp(row.lastChangedAt)}
                </TableCell>
                <TableCell className="text-sm">
                  {formatTimestamp(row.lastSeenAt)}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
