"use client";

import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { formatCount } from "@/lib/format-count";
import { lineSegments } from "@/modules/dashboard/antifraud-series";
import {
  AXIS_BASELINE,
  AXIS_TOP,
  axisCeiling,
  axisTicks,
  axisTickTop,
  callCountLabel,
  chartTimeIndexes,
  eventCountLabel,
  formatTrafficDayTitle,
  formatUtcMinute,
  provisionalMinuteIndex,
  recentWindowMarks,
  requestCountLabel,
  sessionCountLabel,
  TWO_HOUR_MINUTES,
} from "@/modules/dashboard/concurrency";
import { dashboardSeriesLabel, type DashboardSeriesId } from "@/modules/dashboard/series";
import type {
  DashboardCalls,
  DashboardChartLine,
  DashboardLineTone,
} from "@/modules/dashboard/types";

const POLL_MS = 60_000;
const DAY_MINUTES = 1440;
const UNAVAILABLE = "График звонков недоступен.";

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

type XLabel = {
  key: string;
  text: string;
  style: CSSProperties;
};

export function CallsChart({
  series,
  node,
}: {
  series: DashboardSeriesId;
  node: string | null;
}) {
  const [body, setBody] = useState<DashboardCalls | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const params = new URLSearchParams({ series });
        if (node) params.set("node", node);
        const response = await fetch(`/api/dashboard/calls?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          let message = UNAVAILABLE;
          try {
            const failed = (await response.json()) as { message?: unknown };
            if (typeof failed.message === "string" && failed.message.trim() !== "") {
              message = failed.message;
            }
          } catch {
            message = UNAVAILABLE;
          }
          if (!cancelled) setBody({ status: "unavailable", series, node, message });
          return;
        }
        const next = (await response.json()) as DashboardCalls;
        if (cancelled) return;
        if (
          next.status !== "hidden" &&
          (next.series !== series || (next.node ?? "") !== (node ?? ""))
        ) {
          return;
        }
        setBody(next);
      } catch {
        if (!cancelled)
          setBody({ status: "unavailable", series, node, message: UNAVAILABLE });
      } finally {
        loading = false;
      }
    };

    const stop = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (cancelled || timer != null) return;
      timer = window.setInterval(() => {
        void load();
      }, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void load();
      start();
    };

    void load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [series, node]);

  const shown =
    body &&
    (body.status === "hidden" ||
      (body.series === series && (body.node ?? "") === (node ?? "")))
      ? body
      : null;
  if (shown?.status === "hidden") return null;

  const ready = shown?.status === "ready" ? shown : null;
  const message = chartMessage(shown);
  const dayOrigin = ready ? utcMidnight(ready.day) : null;
  const dayTitle = ready ? formatTrafficDayTitle(ready.day) : null;
  const recent = ready ? recentSeries(ready) : null;
  const events = series === "errors" || series === "af-timeout";
  const steady = events || series === "af-answers" || series === "af-delay";
  const seriesTitle = dashboardSeriesLabel(series);
  const countLabel = countLabelFor(series);
  const dayLines = ready && Array.isArray(ready.lines) ? ready.lines : null;
  const recentLines =
    ready && Array.isArray(ready.recent.lines) ? ready.recent.lines : null;
  const note = ready?.note ?? null;

  return (
    <div className="flex flex-col gap-6">
      <ConcurrencyChart
        title={dayTitle ? `${seriesTitle} за ${dayTitle}` : seriesTitle}
        minutes={ready?.minutes ?? null}
        peak={ready?.peak ?? 0}
        span={DAY_MINUTES}
        origin={dayOrigin}
        labels={dayOrigin ? timeLabels(dayOrigin, DAY_MINUTES) : []}
        provisionalFrom={
          ready
            ? steady
              ? ready.minutes.length
              : provisionalMinuteIndex(ready.minutes.length)
            : 0
        }
        windowMarks={
          ready && recent && dayOrigin
            ? recentWindowMarks(
                dayOrigin.getTime(),
                recent.origin.getTime(),
                TWO_HOUR_MINUTES,
                DAY_MINUTES,
              )
            : []
        }
        events={events}
        series={series}
        lines={dayLines}
        note={note}
        countLabel={countLabel}
        message={dayOrigin || !ready ? message : UNAVAILABLE}
      />
      <ConcurrencyChart
        title={twoHourTitle(series)}
        minutes={recent?.minutes ?? null}
        peak={recent?.peak ?? 0}
        span={TWO_HOUR_MINUTES}
        origin={recent?.origin ?? null}
        labels={recent ? timeLabels(recent.origin, TWO_HOUR_MINUTES) : []}
        provisionalFrom={
          recent
            ? steady
              ? recent.minutes.length
              : provisionalMinuteIndex(recent.minutes.length)
            : 0
        }
        events={events}
        series={series}
        lines={recentLines}
        note={note}
        countLabel={countLabel}
        message={recent || !ready ? message : UNAVAILABLE}
      />
    </div>
  );
}

function ConcurrencyChart({
  title,
  minutes,
  peak,
  span,
  origin,
  labels,
  provisionalFrom,
  windowMarks = [],
  events,
  series,
  lines,
  note,
  countLabel,
  message,
}: {
  title: string;
  minutes: number[] | null;
  peak: number;
  span: number;
  origin: Date | null;
  labels: XLabel[];
  provisionalFrom: number;
  windowMarks?: number[];
  events: boolean;
  series: DashboardSeriesId;
  lines: DashboardChartLine[] | null;
  note: string | null;
  countLabel: (count: number) => string;
  message: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const caption =
    lines != null
      ? multiCaption(series, origin, lines, hover, peak, countLabel)
      : chartCaption(minutes, origin, peak, hover, series, countLabel);
  const hovered = minutes != null && hover != null ? minutes[hover] : undefined;

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs tabular-nums">{caption}</p>
        {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
      </div>
      {minutes != null && origin != null ? (
        <div className="flex flex-col gap-2">
          <div className="flex">
            <Scale peak={peak} />
            <div className="min-w-0 flex-1">
              {lines != null ? (
                <MultiPlot
                  lines={lines}
                  peak={peak}
                  span={span}
                  length={minutes.length}
                  hover={hover}
                  onHover={setHover}
                  label={caption}
                  windowMarks={windowMarks}
                />
              ) : (
                <CallsPlot
                  minutes={minutes}
                  peak={peak}
                  span={span}
                  provisionalFrom={provisionalFrom}
                  events={events}
                  hover={hover}
                  onHover={setHover}
                  label={
                    hover != null && hovered != null
                      ? `${formatUtcMinute(origin, hover)}: ${countLabel(hovered)}`
                      : `Максимум: ${countLabel(peak)}`
                  }
                  windowMarks={windowMarks}
                />
              )}
              <div className="relative h-4">
                {labels.map((item) => (
                  <span
                    key={item.key}
                    className="text-muted-foreground absolute top-0 text-[10px] tabular-nums"
                    style={item.style}
                  >
                    {item.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {lines != null ? <LineLegend lines={lines} /> : null}
        </div>
      ) : (
        <div className="text-muted-foreground flex h-36 items-center text-sm">
          {message}
        </div>
      )}
    </section>
  );
}

function Scale({ peak }: { peak: number }) {
  const ceiling = axisCeiling(peak);
  return (
    <div className="relative h-36 w-14 shrink-0">
      {axisTicks(peak).map((tick) => (
        <span
          key={tick}
          className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[10px] tabular-nums"
          style={{ top: `${axisTickTop(tick, ceiling)}%` }}
        >
          {formatCount(tick)}
        </span>
      ))}
    </div>
  );
}

function CallsPlot({
  minutes,
  peak,
  span,
  provisionalFrom,
  events,
  hover,
  onHover,
  label,
  windowMarks,
}: {
  minutes: number[];
  peak: number;
  span: number;
  provisionalFrom: number;
  events: boolean;
  hover: number | null;
  onHover: (minute: number | null) => void;
  label: string;
  windowMarks: number[];
}) {
  const ceiling = axisCeiling(peak);
  const split = Math.max(0, Math.min(minutes.length, Math.trunc(provisionalFrom)));
  const stable = stepGeometry(minutes, ceiling, 0, split);
  const provisional = stepGeometry(minutes, ceiling, split, minutes.length);
  const ticks = axisTicks(peak);

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    let minute = Math.floor(((event.clientX - rect.left) / rect.width) * span);
    if (minute === span) minute -= 1;
    if (minute < 0 || minute >= minutes.length) {
      onHover(null);
      return;
    }
    onHover(minute);
  };

  return (
    <svg
      className="h-36 w-full"
      viewBox={`0 0 ${span} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
    >
      {ticks.map((tick) => {
        const y = axisTickTop(tick, ceiling);
        return (
          <line
            key={tick}
            x1={0}
            x2={span}
            y1={y}
            y2={y}
            className="text-muted-foreground"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {windowMarks.map((mark) => (
        <line
          key={mark}
          x1={mark}
          x2={mark}
          y1={0}
          y2={100}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <SeriesPaths
        className={
          events
            ? "text-red-600 dark:text-red-400"
            : "text-emerald-600 dark:text-emerald-400"
        }
        geometry={stable}
      />
      <SeriesPaths className="text-blue-600 dark:text-blue-400" geometry={provisional} />
      {hover != null && hover < minutes.length ? (
        <line
          x1={hover + 0.5}
          x2={hover + 0.5}
          y1={0}
          y2={100}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.45}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function SeriesPaths({
  className,
  geometry,
}: {
  className: string;
  geometry: { line: string; area: string };
}) {
  if (!geometry.line) return null;
  return (
    <g className={className}>
      <path d={geometry.area} fill="currentColor" fillOpacity={0.18} stroke="none" />
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function stepGeometry(
  minutes: number[],
  ceiling: number,
  from: number,
  to: number,
): { line: string; area: string } {
  if (to <= from) return { line: "", area: "" };
  const y = (value: number) => {
    if (ceiling <= 0) return AXIS_BASELINE;
    return AXIS_BASELINE - (value / ceiling) * (AXIS_BASELINE - AXIS_TOP);
  };
  const heightAt = (index: number) => y(minutes[index] ?? 0).toFixed(2);
  let line = "";
  if (from === 0) {
    line += `M0,${heightAt(0)}`;
  } else {
    line += `M${from},${y(minutes[from - 1] ?? 0).toFixed(2)}L${from},${heightAt(from)}`;
  }
  line += `L${from + 1},${heightAt(from)}`;
  for (let index = from + 1; index < to; index += 1) {
    line += `L${index},${heightAt(index)}L${index + 1},${heightAt(index)}`;
  }
  return { line, area: `${line}L${to},${AXIS_BASELINE}L${from},${AXIS_BASELINE}Z` };
}

function chartCaption(
  minutes: number[] | null,
  origin: Date | null,
  peak: number,
  hover: number | null,
  series: DashboardSeriesId,
  countLabel: (count: number) => string,
): string {
  const summary = seriesSummary(series);
  if (minutes == null || origin == null) return summary;
  const hovered = hover == null ? undefined : minutes[hover];
  if (hover != null && hovered != null) {
    return `${formatUtcMinute(origin, hover)} · ${countLabel(hovered)}`;
  }
  return `макс. ${formatCount(peak)} · ${summary}`;
}

function chartMessage(body: DashboardCalls | null): string {
  if (body?.status === "vacuum" || body?.status === "unavailable") return body.message;
  return "…";
}

function recentSeries(
  ready: ReadyCalls,
): { origin: Date; minutes: number[]; peak: number } | null {
  const origin = new Date(ready.recent.start);
  if (Number.isNaN(origin.getTime())) return null;
  if (!Array.isArray(ready.recent.minutes) || ready.recent.minutes.length === 0) {
    return null;
  }
  return { origin, minutes: ready.recent.minutes, peak: ready.recent.peak };
}

function utcMidnight(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const TONE_CLASS: Record<DashboardLineTone, string> = {
  amber: "text-amber-600 dark:text-amber-400",
  zinc: "text-zinc-500 dark:text-zinc-400",
  stone: "text-stone-500 dark:text-stone-400",
  slate: "text-slate-500 dark:text-slate-300",
  orange: "text-orange-600 dark:text-orange-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  green: "text-green-600 dark:text-green-400",
  teal: "text-teal-600 dark:text-teal-400",
  red: "text-red-600 dark:text-red-400",
  rose: "text-rose-600 dark:text-rose-400",
  violet: "text-violet-600 dark:text-violet-400",
  purple: "text-purple-600 dark:text-purple-400",
  fuchsia: "text-fuchsia-600 dark:text-fuchsia-400",
  sky: "text-sky-600 dark:text-sky-400",
  blue: "text-blue-600 dark:text-blue-400",
  pink: "text-pink-600 dark:text-pink-400",
};

function MultiPlot({
  lines,
  peak,
  span,
  length,
  hover,
  onHover,
  label,
  windowMarks,
}: {
  lines: DashboardChartLine[];
  peak: number;
  span: number;
  length: number;
  hover: number | null;
  onHover: (minute: number | null) => void;
  label: string;
  windowMarks: number[];
}) {
  const ceiling = axisCeiling(peak);
  const ticks = axisTicks(peak);
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    let minute = Math.floor(((event.clientX - rect.left) / rect.width) * span);
    if (minute === span) minute -= 1;
    if (minute < 0 || minute >= length) {
      onHover(null);
      return;
    }
    onHover(minute);
  };
  return (
    <svg
      className="h-36 w-full"
      viewBox={`0 0 ${span} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
    >
      {ticks.map((tick) => {
        const y = axisTickTop(tick, ceiling);
        return (
          <line
            key={tick}
            x1={0}
            x2={span}
            y1={y}
            y2={y}
            className="text-muted-foreground"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {windowMarks.map((mark) => (
        <line
          key={mark}
          x1={mark}
          x2={mark}
          y1={0}
          y2={100}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.map((line) =>
        lineSegments(line.minutes).map((segment) => (
          <path
            key={`${line.id}-${segment.from}`}
            d={segmentPath(line.minutes, ceiling, segment.from, segment.to)}
            className={TONE_CLASS[line.tone]}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {hover != null && hover < length ? (
        <line
          x1={hover + 0.5}
          x2={hover + 0.5}
          y1={0}
          y2={100}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.45}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function segmentPath(
  minutes: readonly (number | null)[],
  ceiling: number,
  from: number,
  to: number,
): string {
  const y = (value: number) => {
    if (ceiling <= 0) return AXIS_BASELINE;
    return AXIS_BASELINE - (value / ceiling) * (AXIS_BASELINE - AXIS_TOP);
  };
  const heightAt = (index: number) => y(minutes[index] ?? 0).toFixed(2);
  let line = `M${from},${heightAt(from)}L${from + 1},${heightAt(from)}`;
  for (let index = from + 1; index < to; index += 1) {
    line += `L${index},${heightAt(index)}L${index + 1},${heightAt(index)}`;
  }
  return line;
}

function LineLegend({ lines }: { lines: DashboardChartLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {lines.map((line) => (
        <li key={line.id} className="flex items-center gap-1.5">
          <span
            className={`inline-block size-2 rounded-full bg-current ${TONE_CLASS[line.tone]}`}
          />
          <span>
            {line.label}
            {line.total != null ? ` · ${formatCount(line.total)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function countLabelFor(series: DashboardSeriesId): (count: number) => string {
  if (series === "af-timeout") return requestCountLabel;
  if (series === "af-answers") return callCountLabel;
  if (series === "af-delay") return (count) => `${formatCount(count)} мс`;
  if (series === "errors") return eventCountLabel;
  return sessionCountLabel;
}

function twoHourTitle(series: DashboardSeriesId): string {
  if (series === "errors") return "Ошибки звонков за два часа";
  if (series === "af-answers") return "Ответы АнтиФрода за два часа";
  if (series === "af-delay") return "Задержка АнтиФрода за два часа";
  if (series === "af-timeout") return "Таймаут АнтиФрода за два часа";
  return "Предварительный трафик за два часа по закончившимся звонкам";
}

function seriesSummary(series: DashboardSeriesId): string {
  if (series === "af-answers") {
    return "За минуту UTC, по времени старта. Прошедшая минута ещё может измениться.";
  }
  if (series === "af-delay") {
    return "Среднее за минуту UTC. Пустая минута — нет замера. Прошедшая минута ещё может измениться.";
  }
  if (series === "af-timeout") {
    return "За минуту UTC, по журналу Parking. Прошедшая минута ещё может измениться.";
  }
  if (series === "errors") {
    return "За минуту, по загруженным CDR. Последний час ещё может дополниться.";
  }
  return "Одновременно, по загруженным CDR";
}

function multiCaption(
  series: DashboardSeriesId,
  origin: Date | null,
  lines: DashboardChartLine[],
  hover: number | null,
  peak: number,
  countLabel: (count: number) => string,
): string {
  const summary = seriesSummary(series);
  if (origin == null || hover == null) return `макс. ${formatCount(peak)} · ${summary}`;
  const clock = formatUtcMinute(origin, hover);
  const parts = lines.flatMap((line) => {
    const value = line.minutes[hover];
    if (value == null) return [];
    if (series === "af-answers" && value === 0) return [];
    return [`${line.label} ${countLabel(value)}`];
  });
  if (parts.length === 0) {
    return series === "af-delay" ? `${clock} · нет замера` : `${clock} · 0`;
  }
  return `${clock} · ${parts.join(" · ")}`;
}

function timeLabels(origin: Date, span: number): XLabel[] {
  return chartTimeIndexes(span).map((index) => ({
    key: String(index),
    text: formatUtcMinute(origin, index),
    style:
      index === 0
        ? { left: 0 }
        : {
            left: `${(index / span) * 100}%`,
            transform: "translateX(-50%)",
          },
  }));
}
