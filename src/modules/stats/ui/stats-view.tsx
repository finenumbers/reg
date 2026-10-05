"use client";

import { useMemo, useState } from "react";
import { FitSelect } from "@/components/fit-select";
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

const PLATFORM_GROUPS = ["Входящий трафик", "Исходящий трафик"] as const;

const MINUTES_CELL = "text-right font-bold";
const MINUTES_TOTAL_CELL =
  "text-right font-bold bg-yellow-300 text-black hover:bg-yellow-300";

const NAME_COL_PX = 210;
const METRIC_COL_PX = 90;

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

  const monthSelectOptions = useMemo(
    () =>
      monthOptions.map((item) => ({
        value: item.key,
        label: formatMonthOption(item.year, item.month, item.count),
      })),
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
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">Статистика</h1>
          <p className="text-muted-foreground text-sm">
            Саммари входящих и исходящих звонков / минут по SIP-транкам и технологическим
            платформам.
          </p>
        </div>
        <FitSelect
          id="stats-month"
          value={data.month}
          options={monthSelectOptions}
          onChange={(value) => void onMonthChange(value)}
          disabled={loading}
          aria-label="Календарный месяц"
          textClassName="text-sm"
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
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
        <GroupedMetricTable
          title="Технологические платформы"
          nameHeader="Платформа"
          groupLabels={PLATFORM_GROUPS}
          rows={data.platform.rows.map((row) => ({
            name: row.name,
            pairs: [
              { calls: row.inCalls, minutes: row.inMinutes },
              { calls: row.outCalls, minutes: row.outMinutes },
            ],
          }))}
          totals={[
            {
              calls: data.platform.totals.inCalls,
              minutes: data.platform.totals.inMinutes,
            },
            {
              calls: data.platform.totals.outCalls,
              minutes: data.platform.totals.outMinutes,
            },
          ]}
        />
        <p className="text-muted-foreground text-sm">
          Звонок учитывается в каждой подходящей категории; итог не сверяется с числом CDR
          за месяц. Межгород — исходящие звонки и минуты парного{" "}
          <span className="font-mono">PSTN_*_LDC</span>; входящие LDC в таблице нет.
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
  const tableWidth = NAME_COL_PX + groupLabels.length * METRIC_COL_PX * 2;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="overflow-auto">
        <Table className="table-fixed" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: NAME_COL_PX }} />
            {groupLabels.flatMap((group) => [
              <col key={`${group}-c`} style={{ width: METRIC_COL_PX }} />,
              <col key={`${group}-m`} style={{ width: METRIC_COL_PX }} />,
            ])}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="h-auto align-middle">
                {nameHeader}
              </TableHead>
              {groupLabels.map((label) => (
                <TableHead key={label} colSpan={2} className="text-center">
                  {label}
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {groupLabels.flatMap((group) => [
                <TableHead key={`${group}-calls`} className="top-7 text-right">
                  Звонки
                </TableHead>,
                <TableHead key={`${group}-minutes`} className="top-7 text-right">
                  Минуты
                </TableHead>,
              ])}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-muted-foreground">
                  Нет данных за выбранный месяц
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>{row.name}</TableCell>
                  {row.pairs.map((pair, i) => (
                    <MetricCells key={`${row.name}-${groupLabels[i] ?? i}`} pair={pair} />
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 ? (
            <TableFooter className="bg-transparent font-bold">
              <TableRow>
                <TableCell>Итого</TableCell>
                {totals.map((pair, i) => (
                  <MetricCells key={`total-${groupLabels[i] ?? i}`} pair={pair} total />
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </section>
  );
}

function MetricCells({ pair, total = false }: { pair: MetricPair; total?: boolean }) {
  return (
    <>
      <TableCell className="text-right">{formatStatCount(pair.calls)}</TableCell>
      <TableCell className={total ? MINUTES_TOTAL_CELL : MINUTES_CELL}>
        {formatStatCount(pair.minutes)}
      </TableCell>
    </>
  );
}

function formatStatCount(n: number): string {
  return n === 0 ? "-" : formatCount(n);
}
