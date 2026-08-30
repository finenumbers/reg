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
  VOIPMONITOR_COLUMN_IN,
  VOIPMONITOR_COLUMN_SET,
} from "@/modules/traffic/columns";
import { buildTrafficFacetsUrl } from "@/modules/traffic/api-client";
import type { TrafficListItem } from "@/modules/traffic/service";
import { classifyTrafficListRow } from "@/modules/traffic/row-flags";
import { cn } from "@/lib/utils";
import {
  nextTimeSort,
  timeSortChevron,
  type TimeSort,
} from "@/modules/traffic/traffic-sort";
import {
  displayTrafficFacet,
  formatTrafficCell,
  trafficMissingLabelClass,
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
  month: string;
  phantom?: boolean;
  callErrors?: boolean;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
  timeSort?: TimeSort | null;
  onTimeSortChange?: (next: TimeSort | null) => void;
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
  month,
  phantom = false,
  callErrors = false,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
  timeSort = null,
  onTimeSortChange,
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
              {h === "cdr_time" && onTimeSortChange ? (
                <TimeSortHeader
                  header={headerLabels?.[h] ?? h}
                  timeSort={timeSort}
                  onChange={onTimeSortChange}
                />
              ) : VOIPMONITOR_COLUMN_SET.has(h) ? (
                (headerLabels?.[h] ?? h)
              ) : (
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
                      month,
                      phantom,
                      callErrors,
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
              )}
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
          data.map((row) => {
            const flag = classifyTrafficListRow(row.data);
            return (
            <TableRow
              key={row.id}
              className={cn(
                flag === "phantom" &&
                  "bg-zinc-300 hover:bg-zinc-400/90 dark:bg-zinc-700 dark:hover:bg-zinc-600",
                flag === "call_error" &&
                  "bg-destructive/25 hover:bg-destructive/35",
              )}
            >
              {headers.map((h) => {
                const raw = row.data[h] ?? "";
                const shown = formatTrafficCell(h, raw);
                return (
                  <TableCell
                    key={h}
                    className={cn(
                      "whitespace-nowrap",
                      DEFAULT_BOLD.has(h) && "font-bold",
                      trafficMissingLabelClass(shown),
                    )}
                  >
                    {VOIPMONITOR_COLUMN_SET.has(h) ? (
                      raw ? (
                        <a
                          href={raw}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.data[
                            h === VOIPMONITOR_COLUMN_IN
                              ? "voipmonitor_cdr_id_in"
                              : "voipmonitor_cdr_id_out"
                          ] || "открыть"}
                        </a>
                      ) : null
                    ) : highlightSet.has(h) ? (
                      <HighlightText text={shown} query={phoneQ} />
                    ) : (
                      shown
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

function TimeSortHeader({
  header,
  timeSort,
  onChange,
}: {
  header: string;
  timeSort: TimeSort | null;
  onChange: (next: TimeSort | null) => void;
}) {
  const active = timeSort != null;
  const label =
    timeSort === "desc"
      ? "Дата и время, по убыванию. Нажмите для возрастания"
      : timeSort === "asc"
        ? "Дата и время, по возрастанию. Нажмите чтобы сбросить"
        : "Сортировать по дате и времени";
  return (
    <div className={`col-header col-header-sort${active ? " active" : ""}`}>
      <button
        type="button"
        className="col-filter-trigger"
        aria-label={label}
        aria-pressed={active}
        onClick={() => onChange(nextTimeSort(timeSort))}
      >
        <span className="col-header-label">{header}</span>
        <span className="col-filter-chevron" aria-hidden>
          {timeSortChevron(timeSort)}
        </span>
      </button>
    </div>
  );
}
