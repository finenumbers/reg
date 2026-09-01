"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  TableCountFooter,
  TableInfiniteBody,
} from "@/components/table-infinite-body";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { formatCount } from "@/lib/format-count";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { cn } from "@/lib/utils";
import { fetchDetailSnapshot } from "@/modules/detail/api-client";
import type { DetailSnapshot, DetailTableTotals } from "@/modules/detail/service";
import {
  sortDetailRows,
  type DetailMetricRow,
  type DetailSortGroup,
  type DetailSortKey,
} from "@/modules/detail/sort";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import { formatMonthOption } from "@/modules/traffic/month-labels";

type Props = { initial: DetailSnapshot };

const GROUPS = [
  { key: "in", label: "Входящий трафик" },
  { key: "out", label: "Исходящий трафик" },
  { key: "parking", label: "Входящий паркинг" },
  { key: "external", label: "Внешние исходящие" },
  { key: "ldc", label: "Межгород" },
] as const satisfies readonly { key: DetailSortGroup; label: string }[];

const MINUTES_CELL = "text-right font-bold";
const MINUTES_TOTAL_CELL =
  "sticky bottom-0 z-10 text-right font-bold bg-yellow-300 text-black hover:bg-yellow-300";
const FOOTER_CELL = "sticky bottom-0 z-10 bg-background font-bold";
const SORT_BTN =
  "inline-flex h-8 max-h-8 w-full items-center justify-center bg-transparent px-0 text-inherit";
const SORT_ACTIVE = "text-blue-600";
const METRIC_COL_PX = 90;
const CLIENT_COL_MIN_PX = 250;
const CLIENT_CELL_PAD_PX = 16;

type MetricPair = { calls: number; minutes: number };

export function DetailView({ initial }: Props) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<DetailSortKey>("client");
  const [shown, setShown] = useState(TABLE_PAGE_SIZE);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const [clientColPx, setClientColPx] = useState(CLIENT_COL_MIN_PX);
  const measureRef = useRef<HTMLSpanElement>(null);

  const monthOptions = useMemo(() => {
    if (data.months.some((item) => item.key === data.month)) return data.months;
    const extra = parseMonthKey(data.month);
    return extra ? [extra, ...data.months] : data.months;
  }, [data.month, data.months]);

  const longestMonthLabel = useMemo(
    () =>
      monthOptions
        .map((item) => formatMonthOption(item.year, item.month, item.count))
        .reduce((a, b) => (b.length > a.length ? b : a), "Август 2026 года"),
    [monthOptions],
  );

  const longestClient = useMemo(() => {
    return data.rows.reduce(
      (best, row) => (row.client.length > best.length ? row.client : best),
      "Клиент",
    );
  }, [data.rows]);

  useLayoutEffect(() => {
    const measured = measureRef.current?.offsetWidth ?? 0;
    setClientColPx(Math.max(CLIENT_COL_MIN_PX, measured + CLIENT_CELL_PAD_PX));
  }, [longestClient]);

  const sorted = useMemo(
    () => sortDetailRows(data.rows, sortKey),
    [data.rows, sortKey],
  );
  const visible = sorted.slice(0, shown);
  const tableWidth = clientColPx + GROUPS.length * METRIC_COL_PX * 2;

  const loadMore = useCallback(() => {
    setShown((current) => Math.min(sorted.length, current + TABLE_PAGE_SIZE));
  }, [sorted.length]);

  const sentinelRef = useInfiniteScroll({
    enabled: shown < sorted.length,
    onLoadMore: loadMore,
    root: scrollRoot,
  });

  function setSort(next: DetailSortKey) {
    setSortKey(next);
    setShown(TABLE_PAGE_SIZE);
  }

  async function onMonthChange(next: string) {
    setLoading(true);
    const result = await fetchDetailSnapshot(next);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setData(result.data);
    setSortKey("client");
    setShown(TABLE_PAGE_SIZE);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Детализация</h1>
          <p className="text-muted-foreground text-sm">
            Звонки и минуты по клиентам каталога номеров за календарный месяц.
          </p>
        </div>
        <div className="relative inline-grid">
          <select
            id="detail-month"
            value={data.month}
            onChange={(e) => void onMonthChange(e.target.value)}
            disabled={loading}
            aria-label="Календарный месяц"
            className="border-border bg-background focus-visible:border-ring focus-visible:ring-ring/50 col-start-1 row-start-1 h-8 w-full rounded-lg border py-0 pr-8 pl-2.5 text-sm outline-none focus-visible:ring-3 disabled:opacity-60"
          >
            {monthOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {formatMonthOption(item.year, item.month, item.count)}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 h-8 border border-transparent py-0 pr-8 pl-2.5 text-sm whitespace-nowrap"
          >
            {longestMonthLabel}
          </span>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      <span
        ref={measureRef}
        aria-hidden
        className="invisible absolute text-sm whitespace-nowrap"
      >
        {longestClient}
      </span>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody scrollRef={setScrollRoot} sentinelRef={sentinelRef}>
          <DetailTable
            clientColPx={clientColPx}
            tableWidth={tableWidth}
            sortKey={sortKey}
            onSort={setSort}
            rows={visible}
            totals={data.totals}
            empty={data.rows.length === 0}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={visible.length} total={data.rows.length} />
      </div>
    </div>
  );
}

function DetailTable({
  clientColPx,
  tableWidth,
  sortKey,
  onSort,
  rows,
  totals,
  empty,
}: {
  clientColPx: number;
  tableWidth: number;
  sortKey: DetailSortKey;
  onSort: (key: DetailSortKey) => void;
  rows: DetailMetricRow[];
  totals: DetailTableTotals;
  empty: boolean;
}) {
  const colSpan = 1 + GROUPS.length * 2;
  return (
    <Table className="table-fixed" style={{ width: tableWidth }}>
      <colgroup>
        <col style={{ width: clientColPx }} />
        {GROUPS.flatMap((group) => [
          <col key={`${group.key}-c`} style={{ width: METRIC_COL_PX }} />,
          <col key={`${group.key}-m`} style={{ width: METRIC_COL_PX }} />,
        ])}
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead
            rowSpan={2}
            className="h-auto align-middle"
            aria-sort={sortKey === "client" ? "ascending" : "none"}
          >
            <SortButton
              active={sortKey === "client"}
              label="Клиент"
              onClick={() => onSort("client")}
            />
          </TableHead>
          {GROUPS.map((group) => (
            <TableHead
              key={group.key}
              colSpan={2}
              className="h-8 text-center"
              aria-sort={sortKey === group.key ? "descending" : "none"}
            >
              <SortButton
                active={sortKey === group.key}
                label={group.label}
                onClick={() => onSort(group.key)}
              />
            </TableHead>
          ))}
        </TableRow>
        <TableRow>
          {GROUPS.flatMap((group) => [
            <TableHead key={`${group.key}-calls`} className="top-8 text-right">
              Звонки
            </TableHead>,
            <TableHead key={`${group.key}-minutes`} className="top-8 text-right">
              Минуты
            </TableHead>,
          ])}
        </TableRow>
      </TableHeader>
      <TableBody>
        {empty ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-muted-foreground">
              Нет данных за выбранный месяц
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.client}>
              <TableCell>{row.client}</TableCell>
              {metricPairs(row).map((pair, i) => (
                <MetricCells key={`${row.client}-${GROUPS[i]?.key ?? i}`} pair={pair} />
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
      {!empty ? (
        <TableFooter className="bg-transparent font-bold">
          <TableRow>
            <TableCell className={FOOTER_CELL}>Итого</TableCell>
            {metricPairs(totals).map((pair, i) => (
              <MetricCells
                key={`total-${GROUPS[i]?.key ?? i}`}
                pair={pair}
                total
              />
            ))}
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}

function SortButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(SORT_BTN, active && SORT_ACTIVE)}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function metricPairs(row: DetailMetricRow | DetailTableTotals): MetricPair[] {
  return [
    { calls: row.inCalls, minutes: row.inMinutes },
    { calls: row.outCalls, minutes: row.outMinutes },
    { calls: row.parkingCalls, minutes: row.parkingMinutes },
    { calls: row.externalCalls, minutes: row.externalMinutes },
    { calls: row.ldcCalls, minutes: row.ldcMinutes },
  ];
}

function MetricCells({
  pair,
  total = false,
}: {
  pair: MetricPair;
  total?: boolean;
}) {
  return (
    <>
      <TableCell className={cn("text-right", total && FOOTER_CELL)}>
        {formatStatCount(pair.calls)}
      </TableCell>
      <TableCell className={total ? MINUTES_TOTAL_CELL : MINUTES_CELL}>
        {formatStatCount(pair.minutes)}
      </TableCell>
    </>
  );
}

function formatStatCount(n: number): string {
  return n === 0 ? "-" : formatCount(n);
}
