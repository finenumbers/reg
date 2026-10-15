"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { formatCount } from "@/lib/format-count";
import type { DashboardCalls } from "@/modules/dashboard/types";

const POLL_MS = 60_000;
const DAY_MINUTES = 1440;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const;

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

export function CallsChart() {
  const [body, setBody] = useState<DashboardCalls | null>(null);
  const [hover, setHover] = useState<number | null>(null);

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
        if (!cancelled) {
          setBody({ status: "unavailable", message: "График звонков недоступен." });
        }
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
  const hovered =
    ready && hover != null && hover < ready.minutes.length ? ready.minutes[hover] : null;

  return (
    <section className="flex flex-col gap-2" aria-label="Звонки сегодня">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Звонки сегодня</h2>
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {ready && hover != null && hovered != null
            ? `${formatMinute(hover)} · ${formatCount(hovered)}`
            : ready
              ? `макс. ${formatCount(ready.peak)} · Одновременно, по загруженным CDR`
              : "Одновременно, по загруженным CDR"}
        </p>
      </div>
      {ready ? (
        <CallsPlot calls={ready} hover={hover} onHover={setHover} />
      ) : (
        <div className="text-muted-foreground flex h-36 items-center text-sm">
          {chartMessage(body)}
        </div>
      )}
      <div className="relative h-4">
        {HOURS.map((hour) => (
          <span
            key={hour}
            className="text-muted-foreground absolute top-0 text-[10px] tabular-nums"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
    </section>
  );
}

function CallsPlot({
  calls,
  hover,
  onHover,
}: {
  calls: ReadyCalls;
  hover: number | null;
  onHover: (minute: number | null) => void;
}) {
  const geometry = stepGeometry(calls.minutes, calls.peak);
  const label =
    hover != null && hover < calls.minutes.length
      ? `${formatMinute(hover)}: ${formatCount(calls.minutes[hover] ?? 0)} одновременно`
      : `Максимум за сутки: ${formatCount(calls.peak)}`;

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minute = Math.floor(((event.clientX - rect.left) / rect.width) * DAY_MINUTES);
    if (minute < 0 || minute >= calls.minutes.length) {
      onHover(null);
      return;
    }
    onHover(minute);
  };

  return (
    <svg
      className="h-36 w-full text-emerald-600 dark:text-emerald-400"
      viewBox={`0 0 ${DAY_MINUTES} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
    >
      <path d={geometry.area} fill="currentColor" fillOpacity={0.18} stroke="none" />
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {hover != null && hover < calls.minutes.length ? (
        <line
          x1={hover + 0.5}
          x2={hover + 0.5}
          y1={0}
          y2={100}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function stepGeometry(minutes: number[], peak: number): { line: string; area: string } {
  const bottom = 98;
  const y = (value: number) => {
    if (peak <= 0) return bottom;
    return bottom - (value / peak) * (bottom - 6);
  };
  let line = "";
  minutes.forEach((value, index) => {
    const height = y(value).toFixed(2);
    line += index === 0 ? `M${index},${height}` : `L${index},${height}`;
    line += `L${index + 1},${height}`;
  });
  const end = minutes.length;
  return { line, area: `${line}L${end},${bottom}L0,${bottom}Z` };
}

function chartMessage(body: DashboardCalls | null): string {
  if (body?.status === "vacuum" || body?.status === "unavailable") return body.message;
  return "…";
}

function formatMinute(index: number): string {
  const hour = Math.floor(index / 60);
  const minute = index % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
