"use client";

import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { formatCount } from "@/lib/format-count";
import {
  AXIS_BASELINE,
  AXIS_TOP,
  axisCeiling,
  axisTicks,
  axisTickTop,
  formatTrafficDayTitle,
  formatUtcMinute,
  provisionalMinuteIndex,
  sessionCountLabel,
  TWO_HOUR_MINUTES,
} from "@/modules/dashboard/concurrency";
import type { DashboardCalls } from "@/modules/dashboard/types";

const POLL_MS = 60_000;
const DAY_MINUTES = 1440;
const UNAVAILABLE = "График звонков недоступен.";

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

type XLabel = {
  key: string;
  text: string;
  style: CSSProperties;
};

export function CallsChart() {
  const [body, setBody] = useState<DashboardCalls | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const response = await fetch("/api/dashboard/calls", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as DashboardCalls;
        if (!cancelled) setBody(next);
      } catch {
        if (!cancelled) setBody({ status: "unavailable", message: UNAVAILABLE });
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
  }, []);

  if (body?.status === "hidden") return null;

  const ready = body?.status === "ready" ? body : null;
  const message = chartMessage(body);
  const dayOrigin = ready ? utcMidnight(ready.day) : null;
  const dayTitle = ready ? formatTrafficDayTitle(ready.day) : null;
  const recent = ready ? recentSeries(ready) : null;

  return (
    <div className="flex flex-col gap-6">
      <ConcurrencyChart
        title={dayTitle ? `Телефонный трафик за ${dayTitle}` : "Телефонный трафик"}
        minutes={ready?.minutes ?? null}
        peak={ready?.peak ?? 0}
        span={DAY_MINUTES}
        origin={dayOrigin}
        labels={dayLabels()}
        provisionalFrom={ready ? provisionalMinuteIndex(ready.minutes.length) : 0}
        message={dayOrigin || !ready ? message : UNAVAILABLE}
      />
      <ConcurrencyChart
        title="Предварительный трафик за два часа по закончившимся звонкам"
        minutes={recent?.minutes ?? null}
        peak={recent?.peak ?? 0}
        span={TWO_HOUR_MINUTES}
        origin={recent?.origin ?? null}
        labels={recent ? recentLabels(recent.origin) : []}
        provisionalFrom={recent ? provisionalMinuteIndex(recent.minutes.length) : 0}
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
  message,
}: {
  title: string;
  minutes: number[] | null;
  peak: number;
  span: number;
  origin: Date | null;
  labels: XLabel[];
  provisionalFrom: number;
  message: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const caption = chartCaption(minutes, origin, peak, hover);
  const hovered = minutes != null && hover != null ? minutes[hover] : undefined;

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs tabular-nums">{caption}</p>
      </div>
      {minutes != null && origin != null ? (
        <div className="flex">
          <Scale peak={peak} />
          <div className="min-w-0 flex-1">
            <CallsPlot
              minutes={minutes}
              peak={peak}
              span={span}
              provisionalFrom={provisionalFrom}
              hover={hover}
              onHover={setHover}
              label={
                hover != null && hovered != null
                  ? `${formatUtcMinute(origin, hover)}: ${sessionCountLabel(hovered)}`
                  : `Максимум: ${sessionCountLabel(peak)}`
              }
            />
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
  hover,
  onHover,
  label,
}: {
  minutes: number[];
  peak: number;
  span: number;
  provisionalFrom: number;
  hover: number | null;
  onHover: (minute: number | null) => void;
  label: string;
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
      <SeriesPaths className="text-emerald-600 dark:text-emerald-400" geometry={stable} />
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
): string {
  if (minutes == null || origin == null) return "Одновременно, по загруженным CDR";
  const hovered = hover == null ? undefined : minutes[hover];
  if (hover != null && hovered != null) {
    return `${formatUtcMinute(origin, hover)} · ${sessionCountLabel(hovered)}`;
  }
  return `макс. ${formatCount(peak)} · Одновременно, по загруженным CDR`;
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

function dayLabels(): XLabel[] {
  return [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
    key: String(hour),
    text: String(hour).padStart(2, "0"),
    style: { left: `${(hour / 24) * 100}%` },
  }));
}

function recentLabels(origin: Date): XLabel[] {
  const last = TWO_HOUR_MINUTES - 1;
  return [0, 30, 60, 90, last].map((index) => ({
    key: String(index),
    text: formatUtcMinute(origin, index),
    style:
      index === 0
        ? { left: 0 }
        : index === last
          ? { right: 0 }
          : {
              left: `${(index / TWO_HOUR_MINUTES) * 100}%`,
              transform: "translateX(-50%)",
            },
  }));
}
