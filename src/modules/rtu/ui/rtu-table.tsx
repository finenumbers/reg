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
import { cn } from "@/lib/utils";
import { geographyDigitMarks, type DigitMark } from "@/modules/rtu/abc-display";
import { buildRtuFacetsUrl } from "@/modules/rtu/api-client";
import {
  geographyDigitAlign,
  RTU_COLUMNS,
  RTU_HEADERS,
  type RtuColumn,
} from "@/modules/rtu/columns";
import { geographyRowTone, type GeographyRowTone } from "@/modules/rtu/row-tone";
import type { RtuItem } from "@/modules/rtu/types";
import { STATUS_ACTIVE, STATUS_BLOCKED } from "@/modules/phones/types";

type Props = {
  data: RtuItem[];
  loading?: boolean;
  emptyMessage?: string;
  filters: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
  lookupFailed?: ReadonlySet<string>;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  onActivation?: (row: RtuItem) => void;
};

const ROW_TONE_CLASS: Record<GeographyRowTone, string> = {
  blocked: "bg-black text-white hover:bg-black hover:text-white",
  missing: "bg-red-600 text-white hover:bg-red-600 hover:text-white",
  unregistered: "bg-destructive/10 hover:bg-destructive/15",
  operator: "bg-blue-200 hover:bg-blue-300 dark:bg-blue-950 dark:hover:bg-blue-900",
  yellow: "bg-amber-400/25 hover:bg-amber-400/35",
  blue: "bg-sky-500/15 hover:bg-sky-500/25",
  none: "",
};

function cellText(row: RtuItem, column: RtuColumn): string {
  return row[column] ?? "";
}

function MarkedDigits({ marks }: { marks: DigitMark[] }) {
  return (
    <>
      {marks.map((part, index) =>
        part.hit ? (
          <mark key={index} className="search-hit">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function RtuTable({
  data,
  loading = false,
  emptyMessage = "Нет данных.",
  filters,
  phoneQ = "",
  blockedOnly = false,
  unregisteredOnly = false,
  missingOnly = false,
  lookupFailed,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  onActivation,
}: Props) {
  const showEmpty = !loading && data.length === 0;
  const colCount = RTU_COLUMNS.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {RTU_COLUMNS.map((column) => (
            <TableHead key={column} className="font-medium">
              <ColumnFilterDropdown
                column={column}
                header={RTU_HEADERS[column]}
                open={openColumn === column}
                selected={filters[column] ?? []}
                filters={filters}
                buildFacetsUrl={({ column: col, filters: next, q }) =>
                  buildRtuFacetsUrl({
                    column: col,
                    filters: next,
                    phoneQ,
                    blockedOnly,
                    unregisteredOnly,
                    missingOnly,
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
            const marks = geographyDigitMarks(row.number, row.abc, row.telephone, phoneQ);
            return (
              <TableRow key={row.id} className={ROW_TONE_CLASS[tone]}>
                {RTU_COLUMNS.map((column) => {
                  const align = geographyDigitAlign(column);
                  const bold = column === "abc" || column === "telephone";
                  return (
                    <TableCell
                      key={`${row.id}-${column}`}
                      className={cn(
                        align === "left" && "text-left tabular-nums",
                        align === "right" && "text-right tabular-nums",
                        bold &&
                          (tone === "blocked" || tone === "missing"
                            ? "font-bold text-white"
                            : "font-bold text-black dark:text-white"),
                      )}
                    >
                      {column === "abc" ? (
                        <MarkedDigits marks={marks.abc} />
                      ) : column === "telephone" ? (
                        <MarkedDigits marks={marks.telephone} />
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
                  );
                })}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
