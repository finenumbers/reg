"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import { cn } from "@/lib/utils";
import {
  MARKING_STATS_NETWORK_SORTS,
  type MarkingStatsNetworkSort,
  type MarkingStatsRow,
} from "@/modules/marking/stats-sort";

const SORT_BTN =
  "inline-flex h-7 max-h-7 w-full items-center justify-end bg-transparent px-0 text-inherit";
const SORT_ACTIVE = "text-blue-600";
const COUNT_CELL = "text-right tabular-nums";
const TOTAL_CELL = "text-right font-bold text-black tabular-nums dark:text-white";
const CLIENT_COL_MIN_PX = 250;
const CLIENT_CELL_PAD_PX = 16;
const NUMBERS_COL_PX = 168;
const NETWORK_COL_PX = 132;
const TOTAL_COL_PX = 88;

const NETWORK_HEADERS: Record<MarkingStatsNetworkSort, string> = {
  mts: "МТС",
  megafon: "Мегафон",
  beeline: "Билайн",
  t2: "Т2",
  external: "Внешние сети",
};

export function MarkingStatsTable({
  rows,
  sortKey,
  onSort,
  preparing,
}: {
  rows: readonly MarkingStatsRow[];
  sortKey: MarkingStatsNetworkSort | null;
  onSort: (key: MarkingStatsNetworkSort) => void;
  preparing: boolean;
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [clientColPx, setClientColPx] = useState(CLIENT_COL_MIN_PX);
  const longestClient = useMemo(() => {
    return rows.reduce(
      (best, row) => (row.client.length > best.length ? row.client : best),
      "Клиент",
    );
  }, [rows]);

  useLayoutEffect(() => {
    const measured = measureRef.current?.offsetWidth ?? 0;
    setClientColPx(Math.max(CLIENT_COL_MIN_PX, measured + CLIENT_CELL_PAD_PX));
  }, [longestClient]);

  const tableWidth =
    clientColPx +
    NUMBERS_COL_PX +
    MARKING_STATS_NETWORK_SORTS.length * NETWORK_COL_PX +
    TOTAL_COL_PX;

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden
        className="invisible absolute text-xs whitespace-nowrap"
      >
        {longestClient}
      </span>
      <Table className="table-fixed" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: clientColPx }} />
          <col style={{ width: NUMBERS_COL_PX }} />
          {MARKING_STATS_NETWORK_SORTS.map((key) => (
            <col key={key} style={{ width: NETWORK_COL_PX }} />
          ))}
          <col style={{ width: TOTAL_COL_PX }} />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="font-medium">Клиент</TableHead>
            <TableHead className="text-right font-medium whitespace-nowrap">
              Количество номеров
            </TableHead>
            {MARKING_STATS_NETWORK_SORTS.map((key) => (
              <TableHead
                key={key}
                className="text-right font-medium whitespace-nowrap"
                aria-sort={sortKey === key ? "descending" : "none"}
              >
                <button
                  type="button"
                  className={cn(SORT_BTN, sortKey === key && SORT_ACTIVE)}
                  aria-pressed={sortKey === key}
                  onClick={() => onSort(key)}
                >
                  {NETWORK_HEADERS[key]}
                </button>
              </TableHead>
            ))}
            <TableHead className="text-right font-medium whitespace-nowrap">
              Итого
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-muted-foreground h-24">
                {preparing
                  ? "Снимок «Управление РТУ» ещё не собран."
                  : "Нет данных за выбранный месяц"}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.client}>
                <TableCell>{row.client}</TableCell>
                <TableCell className={COUNT_CELL}>{formatCount(row.numbers)}</TableCell>
                {MARKING_STATS_NETWORK_SORTS.map((key) => (
                  <TableCell key={key} className={COUNT_CELL}>
                    {formatCount(row[key])}
                  </TableCell>
                ))}
                <TableCell className={TOTAL_CELL}>{formatCount(row.total)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
