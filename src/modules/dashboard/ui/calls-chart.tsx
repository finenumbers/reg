"use client";

import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { formatCount } from "@/lib/format-count";
import {
  AXIS_BASELINE,
  AXIS_TOP,
  axisCeiling,
  axisTicks,
  axisTickTop,
  formatUtcMinute,
  HOUR_MINUTES,
  sessionCountLabel,
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
  const hour = ready ? hourSeries(ready) : null;

  return (
    <div className="flex flex-col gap-6">
      <ConcurrencyChart
        title="Звонки сегодня"
        minutes={ready?.minutes ?? null}
        peak={ready?.peak ?? 0}
        span={DAY_MINUTES}
        origin={dayOrigin}
        labels={dayLabels()}
        message={dayOrigin || !ready ? message : UNAVAILABLE}
      />
      <ConcurrencyChart
        title="Последний час"
        minutes={hour?.minutes ?? null}
        peak={hour?.peak ?? 0}
        span={HOUR_MINUTES}
        origin={hour?.origin ?? null}
        labels={hour ? hourLabels(hour.origin) : []}
        message={hour || !ready ? message : UNAVAILABLE}
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
  message,
}: {
  title: string;
  minutes: number[] | null;
  peak: number;
  span: number;
  origin: Date | null;
  labels: XLabel[];
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
  hover,
  onHover,
  label,
}: {
  minutes: number[];
  peak: number;
  span: number;
  hover: number | null;
  onHover: (minute: number | null) => void;
  label: string;
}) {
  const ceiling = axisCeiling(peak);
  const geometry = stepGeometry(minutes, ceiling);
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
      className="h-36 w-full text-emerald-600 dark:text-emerald-400"
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
      <path d={geometry.area} fill="currentColor" fillOpacity={0.18} stroke="none" />
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
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

function stepGeometry(
  minutes: number[],
  ceiling: number,
): { line: string; area: string } {
  const y = (value: number) => {
    if (ceiling <= 0) return AXIS_BASELINE;
    return AXIS_BASELINE - (value / ceiling) * (AXIS_BASELINE - AXIS_TOP);
  };
  let line = "";
  minutes.forEach((value, index) => {
    const height = y(value).toFixed(2);
    line += index === 0 ? `M${index},${height}` : `L${index},${height}`;
    line += `L${index + 1},${height}`;
  });
  const end = minutes.length;
  return { line, area: `${line}L${end},${AXIS_BASELINE}L0,${AXIS_BASELINE}Z` };
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

function hourSeries(
  ready: ReadyCalls,
): { origin: Date; minutes: number[]; peak: number } | null {
  const origin = new Date(ready.hour.start);
  if (Number.isNaN(origin.getTime())) return null;
  if (!Array.isArray(ready.hour.minutes) || ready.hour.minutes.length === 0) return null;
  return { origin, minutes: ready.hour.minutes, peak: ready.hour.peak };
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

function hourLabels(origin: Date): XLabel[] {
  return [0, 15, 30, 45, 59].map((index) => ({
    key: String(index),
    text: formatUtcMinute(origin, index),
    style:
      index === 0
        ? { left: 0 }
        : index === 59
          ? { right: 0 }
          : { left: `${(index / HOUR_MINUTES) * 100}%`, transform: "translateX(-50%)" },
  }));
}
