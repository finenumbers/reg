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
import { cn } from "@/lib/utils";
import { buildNumberingFacetsUrl } from "@/modules/numbering-resource/api-client";
import {
  isBoldNumberingColumn,
  isNumberingFacetColumn,
  NUMBERING_COLUMNS,
  NUMBERING_HEADERS,
  type NumberingColumn,
} from "@/modules/numbering-resource/columns";
import {
  formatNumberingCount,
  formatRangeSegment,
} from "@/modules/numbering-resource/format";
import {
  effectiveAbcRangeGapMarkers,
  numberingGapShadowClass,
} from "@/modules/numbering-resource/gaps";
import { dadataPartyUrl, yandexMapsUrl } from "@/modules/numbering-resource/links";
import type { NumberingRow } from "@/modules/numbering-resource/types";

type Props = {
  data: NumberingRow[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
};

function cellText(row: NumberingRow, column: NumberingColumn): string {
  if (column === "rangeStart") return formatRangeSegment(row.rangeStart);
  if (column === "rangeEnd") return formatRangeSegment(row.rangeEnd);
  if (column === "capacity") return formatNumberingCount(row.capacity);
  if (column === "uvrAntifraud") {
    return row.uvrAntifraud == null ? "" : String(row.uvrAntifraud);
  }
  if (column === "legalAddress") return row.legalAddress ?? "";
  return row[column];
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

function cellContent(row: NumberingRow, column: NumberingColumn): ReactNode {
  if (column === "legalAddress") {
    const text = row.legalAddress ?? "";
    const href = yandexMapsUrl(text);
    if (!href) return text;
    return <ExternalLink href={href}>{text}</ExternalLink>;
  }
  if (column === "inn") {
    const href = dadataPartyUrl(row.inn);
    if (!href) return row.inn;
    return <ExternalLink href={href}>{row.inn}</ExternalLink>;
  }
  return cellText(row, column);
}

export function NumberingResourceTable({
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
  const colCount = NUMBERING_COLUMNS.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {NUMBERING_COLUMNS.map((column) => (
            <TableHead key={column} className="font-medium">
              {isNumberingFacetColumn(column) ? (
                <ColumnFilterDropdown
                  column={column}
                  header={NUMBERING_HEADERS[column]}
                  open={openColumn === column}
                  selected={filters[column] ?? []}
                  filters={filters}
                  buildFacetsUrl={({ column: col, filters: next, q }) =>
                    buildNumberingFacetsUrl({
                      column: col,
                      filters: next,
                      phoneQ,
                      q,
                    })
                  }
                  onToggle={() =>
                    onOpenColumnChange(openColumn === column ? null : column)
                  }
                  onChange={(values) => onColumnFilterChange(column, values)}
                  onClear={() => onColumnFilterChange(column, [])}
                />
              ) : (
                <span className="col-header-label">{NUMBERING_HEADERS[column]}</span>
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
          data.map((row, index) => {
            const { gapBefore, gapAfter } = effectiveAbcRangeGapMarkers(
              row,
              index > 0 ? data[index - 1] : null,
            );
            const gapClass = numberingGapShadowClass(gapBefore, gapAfter);
            return (
              <TableRow key={row.id}>
                {NUMBERING_COLUMNS.map((column) => (
                  <TableCell
                    key={`${row.id}-${column}`}
                    className={cn(
                      isBoldNumberingColumn(column) &&
                        "font-bold text-black dark:text-white",
                      gapClass,
                    )}
                  >
                    {cellContent(row, column)}
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
