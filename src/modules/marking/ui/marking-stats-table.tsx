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
  type MarkingStatsSortKey,
} from "@/modules/marking/stats-sort";

const SORT_BTN =
  "inline-flex h-7 max-h-7 w-full items-center justify-end bg-transparent px-0 text-inherit";
const SORT_ACTIVE = "text-blue-600";
/** Readable on the pastel column fill. `text-blue-600` falls short of 4.5:1 there. */
const SORT_ACTIVE_ON_FILL = "text-blue-800";
const COUNT_CELL = "text-right tabular-nums";
const TOTAL_CELL = "text-right font-bold text-black tabular-nums dark:text-white";
const CLIENT_COL_MIN_PX = 250;
const CLIENT_CELL_PAD_PX = 16;
const NUMBERS_COL_PX = 168;
const NETWORK_COL_PX = 132;
const TOTAL_COL_PX = 88;

const NUMBERS_HEADER = "Количество номеров";
const BRAND_WIDTH_HEADER = "Внешние сети";
const BRAND_SORTS = [
  "mts",
  "megafon",
  "beeline",
  "t2",
] as const satisfies readonly MarkingStatsNetworkSort[];

const NETWORK_HEADERS: Record<MarkingStatsNetworkSort, string> = {
  mts: "МТС",
  megafon: "Мегафон",
  beeline: "Билайн",
  t2: "Т2",
  external: BRAND_WIDTH_HEADER,
};

/**
 * Light resting fill of the matching «Звонки в ОПРС» row.
 * The dark `*-950` fills stay off: this app has no dark theme, and `dark:`
 * follows the OS, which would put near-black text on a near-black cell.
 */
const NETWORK_FILL = {
  mts: "bg-red-200",
  megafon: "bg-green-200",
  beeline: "bg-yellow-200",
  t2: "bg-gray-200",
} as const satisfies Record<(typeof BRAND_SORTS)[number], string>;

function networkFill(key: MarkingStatsNetworkSort): string | undefined {
  switch (key) {
    case "mts":
    case "megafon":
    case "beeline":
    case "t2":
      return NETWORK_FILL[key];
    case "external":
      return undefined;
  }
}

function SortHeader({
  label,
  active,
  onClick,
  fill,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  fill?: string;
}) {
  return (
    <TableHead
      className={cn("text-right font-medium whitespace-nowrap", fill)}
      aria-sort={active ? "descending" : "none"}
    >
      <button
        type="button"
        className={cn(SORT_BTN, active && (fill ? SORT_ACTIVE_ON_FILL : SORT_ACTIVE))}
        aria-pressed={active}
        onClick={onClick}
      >
        {label}
      </button>
    </TableHead>
  );
}

export function MarkingStatsTable({
  rows,
  sortKey,
  onSort,
  preparing,
}: {
  rows: readonly MarkingStatsRow[];
  sortKey: MarkingStatsSortKey | null;
  onSort: (key: MarkingStatsSortKey) => void;
  preparing: boolean;
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const numbersRef = useRef<HTMLSpanElement>(null);
  const brandRef = useRef<HTMLSpanElement>(null);
  const [clientColPx, setClientColPx] = useState(CLIENT_COL_MIN_PX);
  const [numbersColPx, setNumbersColPx] = useState(NUMBERS_COL_PX);
  const [brandColPx, setBrandColPx] = useState(NETWORK_COL_PX);
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

  useLayoutEffect(() => {
    const numbers = numbersRef.current?.offsetWidth ?? 0;
    const brand = brandRef.current?.offsetWidth ?? 0;
    setNumbersColPx(numbers > 0 ? numbers + CLIENT_CELL_PAD_PX : NUMBERS_COL_PX);
    setBrandColPx(brand > 0 ? brand + CLIENT_CELL_PAD_PX : NETWORK_COL_PX);
  }, []);

  const tableWidth =
    clientColPx +
    numbersColPx +
    MARKING_STATS_NETWORK_SORTS.length * brandColPx +
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
      <span
        ref={numbersRef}
        aria-hidden
        className="invisible absolute text-xs font-medium whitespace-nowrap"
      >
        {NUMBERS_HEADER}
      </span>
      <span
        ref={brandRef}
        aria-hidden
        className="invisible absolute text-xs font-medium whitespace-nowrap"
      >
        {BRAND_WIDTH_HEADER}
      </span>
      <Table className="table-fixed" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: clientColPx }} />
          <col style={{ width: numbersColPx }} />
          {MARKING_STATS_NETWORK_SORTS.map((key) => (
            <col key={key} style={{ width: brandColPx }} />
          ))}
          <col style={{ width: TOTAL_COL_PX }} />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="font-medium">Клиент</TableHead>
            <TableHead className="text-right font-medium whitespace-nowrap">
              {NUMBERS_HEADER}
            </TableHead>
            {BRAND_SORTS.map((key) => (
              <SortHeader
                key={key}
                label={NETWORK_HEADERS[key]}
                active={sortKey === key}
                onClick={() => onSort(key)}
                fill={NETWORK_FILL[key]}
              />
            ))}
            <SortHeader
              label={NETWORK_HEADERS.external}
              active={sortKey === "external"}
              onClick={() => onSort("external")}
            />
            <SortHeader
              label="Итого"
              active={sortKey === "total"}
              onClick={() => onSort("total")}
            />
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
                  <TableCell key={key} className={cn(COUNT_CELL, networkFill(key))}>
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
