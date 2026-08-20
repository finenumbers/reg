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
import { cn } from "@/lib/utils";
import type { PhoneListItem } from "@/modules/phones/service";
import { buildPhonesFacetsUrl } from "@/modules/phones/api-client";
import {
  ENDPOINT_NUMBER_FIELD,
  type PhoneKind,
} from "@/modules/phones/types";

/** Display value for phones table cells (plaintext, including SIP password). */
export function displayPhoneCellValue(_header: string, value: string): string {
  return value;
}

type Props = {
  kind: PhoneKind;
  headers: string[];
  data: PhoneListItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  sipUnregisteredOnly?: boolean;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

export function PhonesTable({
  kind,
  headers,
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  sipUnregisteredOnly = false,
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
                  buildPhonesFacetsUrl({
                    kind,
                    column,
                    filters: f,
                    phoneQ,
                    sipUnregisteredOnly,
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
            <TableRow
              key={row.id}
              className={cn(
                row.sipUnregistered &&
                  "bg-destructive/10 hover:bg-destructive/15",
              )}
            >
              {headers.map((h) => {
                const raw = row.data[h] ?? "";
                const value = displayPhoneCellValue(h, raw);
                return (
                  <TableCell
                    key={`${row.id}-${h}`}
                    className="text-sm"
                  >
                    {h === ENDPOINT_NUMBER_FIELD ? (
                      <HighlightText text={raw} query={phoneQ} />
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
