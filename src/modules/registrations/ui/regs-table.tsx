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
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  buildRegsFacetsUrl,
  displayFacetForColumn,
  formatEndpoint,
  formatTimestamp,
} from "@/modules/registrations/ui-format";
import { RegStatusBadge } from "@/modules/registrations/ui/reg-status-badge";
import { cn } from "@/lib/utils";

const COLUMNS: {
  id: string;
  header: string;
  cell: (row: RegistrationListItem) => React.ReactNode;
}[] = [
  {
    id: "phone",
    header: "Телефон",
    cell: (row) => (
      <span className="font-mono text-sm tabular-nums">{row.phone}</span>
    ),
  },
  {
    id: "description",
    header: "Описание",
    cell: (row) =>
      row.description ? (
        <span className="block max-w-[16rem] truncate text-sm" title={row.description}>
          {row.description}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    id: "status",
    header: "Статус",
    cell: (row) => <RegStatusBadge status={row.status} />,
  },
  {
    id: "endpoint",
    header: "Endpoint",
    cell: (row) => (
      <span className="font-mono text-sm text-muted-foreground">
        {formatEndpoint(row.ip, row.port)}
      </span>
    ),
  },
  {
    id: "lastChangedAt",
    header: "Последнее изменение",
    cell: (row) => (
      <span className="text-sm">{formatTimestamp(row.lastChangedAt)}</span>
    ),
  },
  {
    id: "lastSeenAt",
    header: "Обновление",
    cell: (row) => (
      <span className="text-sm">{formatTimestamp(row.lastSeenAt)}</span>
    ),
  },
];

type Props = {
  data: RegistrationListItem[];
  loading?: boolean;
  emptyMessage?: string;
  selectedPhone?: string | null;
  filters: ColumnFilters;
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
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  onRowClick,
}: Props) {
  const showEmpty = !loading && data.length === 0;
  const colCount = COLUMNS.length;

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {COLUMNS.map((col) => (
            <TableHead key={col.id} className="text-sm font-medium">
              <ColumnFilterDropdown
                column={col.id}
                header={col.header}
                open={openColumn === col.id}
                selected={filters[col.id] ?? []}
                filters={filters}
                buildFacetsUrl={({ column, filters: f, q }) =>
                  buildRegsFacetsUrl({ column, filters: f, q })
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
            <TableCell colSpan={colCount} className="h-24 text-sm text-muted-foreground">
              Загрузка регистраций…
            </TableCell>
          </TableRow>
        ) : showEmpty ? (
          <TableRow>
            <TableCell colSpan={colCount} className="h-24 text-sm text-muted-foreground">
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
                {COLUMNS.map((col) => (
                  <TableCell key={col.id} className="text-sm">
                    {col.cell(row)}
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
