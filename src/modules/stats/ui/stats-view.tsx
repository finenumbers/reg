"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import { fetchStatsSnapshot } from "@/modules/stats/api-client";
import type {
  PstnJoinRow,
  PstnJoinTable,
  StatsDeviceRow,
  StatsSnapshot,
  StatsTable,
} from "@/modules/stats/service";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import { formatMonthOption } from "@/modules/traffic/month-labels";

type Props = { initial: StatsSnapshot };

const SIP_GROUPS = [
  "Входящий трафик",
  "Исходящий трафик",
  "Входящий паркинг",
  "Фантомный трафик",
] as const;

const PSTN_GROUPS = [...SIP_GROUPS, "Межгород"] as const;

const MINUTES_CELL = "text-right font-bold";
const MINUTES_TOTAL_CELL =
  "text-right font-bold bg-yellow-300 text-black hover:bg-yellow-300";

type MetricPair = { calls: number; minutes: number };

export function StatsView({ initial }: Props) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function onMonthChange(next: string) {
    setLoading(true);
    const result = await fetchStatsSnapshot(next);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setData(result.data);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Статистика</h1>
          <p className="text-sm text-muted-foreground">
            Саммари входящих и исходящих звонков / минут по SIP-транкам и
            технологическим платформам.
          </p>
        </div>
        <div className="relative inline-grid">
          <select
            id="stats-month"
            value={data.month}
            onChange={(e) => void onMonthChange(e.target.value)}
            disabled={loading}
            aria-label="Календарный месяц"
            className="col-start-1 row-start-1 h-8 w-full rounded-lg border border-border bg-background py-0 pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            {monthOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {formatMonthOption(item.year, item.month, item.count)}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 h-8 whitespace-nowrap border border-transparent py-0 pl-2.5 pr-8 text-sm"
          >
            {longestMonthLabel}
          </span>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto">
        <GroupedMetricTable
          title="Присоединения к ТфОП"
          nameHeader="Присоединение"
          groupLabels={PSTN_GROUPS}
          rows={data.pstnTfop.rows.map((row) => ({
            name: row.name,
            pairs: metricPairs(row, true),
          }))}
          totals={metricPairs(data.pstnTfop.totals, true)}
        />
        <GroupedMetricTable
          title="Внешняя нумерация"
          nameHeader="SIP-транк"
          groupLabels={SIP_GROUPS}
          rows={data.trunk.rows.map((row) => ({
            name: row.name,
            pairs: metricPairs(row, false),
          }))}
          totals={metricPairs(data.trunk.totals, false)}
        />
        <StatsSummaryTable
          title="Технологические платформы"
          nameHeader="Платформа"
          table={data.platform}
        />
        <p className="text-sm text-muted-foreground">
          Звонок учитывается в каждой подходящей категории; итог не сверяется с
          числом CDR за месяц. Межгород — исходящие звонки и минуты парного{" "}
          <span className="font-mono">PSTN_*_LDC</span>; входящие LDC в таблице
          нет.
        </p>
      </div>
    </div>
  );
}

function metricPairs(
  row: StatsDeviceRow | PstnJoinRow | PstnJoinTable["totals"] | StatsTable["totals"],
  includeLdc: boolean,
): MetricPair[] {
  const pairs: MetricPair[] = [
    { calls: row.inCalls, minutes: row.inMinutes },
    { calls: row.outCalls, minutes: row.outMinutes },
    { calls: row.parkingCalls, minutes: row.parkingMinutes },
    { calls: row.phantomCalls, minutes: row.phantomMinutes },
  ];
  if (includeLdc && "ldcCalls" in row) {
    pairs.push({ calls: row.ldcCalls, minutes: row.ldcMinutes });
  }
  return pairs;
}

function GroupedMetricTable({
  title,
  nameHeader,
  groupLabels,
  rows,
  totals,
}: {
  title: string;
  nameHeader: string;
  groupLabels: readonly string[];
  rows: { name: string; pairs: MetricPair[] }[];
  totals: MetricPair[];
}) {
  const colSpan = 1 + groupLabels.length * 2;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="h-auto align-middle">
                {nameHeader}
              </TableHead>
              {groupLabels.map((label) => (
                <TableHead
                  key={label}
                  colSpan={2}
                  className="text-center"
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {groupLabels.flatMap((group) => [
                <TableHead
                  key={`${group}-calls`}
                  className="top-8 text-right"
                >
                  Звонки
                </TableHead>,
                <TableHead
                  key={`${group}-minutes`}
                  className="top-8 text-right"
                >
                  Минуты
                </TableHead>,
              ])}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-muted-foreground"
                >
                  Нет данных за выбранный месяц
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>{row.name}</TableCell>
                  {row.pairs.map((pair, i) => (
                    <MetricCells
                      key={`${row.name}-${groupLabels[i] ?? i}`}
                      pair={pair}
                    />
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 ? (
            <TableFooter className="bg-transparent">
              <TableRow>
                <TableCell>Итого</TableCell>
                {totals.map((pair, i) => (
                  <MetricCells
                    key={`total-${groupLabels[i] ?? i}`}
                    pair={pair}
                    total
                  />
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </section>
  );
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
      <TableCell className="text-right">
        {formatStatCount(pair.calls)}
      </TableCell>
      <TableCell className={total ? MINUTES_TOTAL_CELL : MINUTES_CELL}>
        {formatStatCount(pair.minutes)}
      </TableCell>
    </>
  );
}

function StatsSummaryTable({
  title,
  nameHeader,
  table,
}: {
  title: string;
  nameHeader: string;
  table: StatsTable;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{nameHeader}</TableHead>
              <TableHead className="text-right">Входящие звонки</TableHead>
              <TableHead className="text-right">Входящие минуты</TableHead>
              <TableHead className="text-right">Исходящие звонки</TableHead>
              <TableHead className="text-right">Исходящие минуты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Нет данных за выбранный месяц
                </TableCell>
              </TableRow>
            ) : (
              table.rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right">
                    {formatStatCount(row.inCalls)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatStatCount(row.inMinutes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatStatCount(row.outCalls)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatStatCount(row.outMinutes)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {table.rows.length > 0 ? (
            <TableFooter className="bg-transparent">
              <TableRow>
                <TableCell>Итого</TableCell>
                <TableCell className="text-right">
                  {formatStatCount(table.totals.inCalls)}
                </TableCell>
                <TableCell className="text-right">
                  {formatStatCount(table.totals.inMinutes)}
                </TableCell>
                <TableCell className="text-right">
                  {formatStatCount(table.totals.outCalls)}
                </TableCell>
                <TableCell className="text-right">
                  {formatStatCount(table.totals.outMinutes)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </section>
  );
}

function formatStatCount(n: number): string {
  return n === 0 ? "-" : formatCount(n);
}
