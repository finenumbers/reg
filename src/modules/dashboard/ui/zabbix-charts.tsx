"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { lineSegments, missingMinutes } from "@/modules/dashboard/antifraud-series";
import { ChartGapBands } from "@/modules/dashboard/ui/gap-bands";
import {
  chartTimeIndexes,
  formatUtcMinute,
  TWO_HOUR_MINUTES,
} from "@/modules/dashboard/concurrency";
import {
  formatZabbixNumber,
  formatZabbixValue,
  zabbixPlotY,
  zabbixScale,
  zabbixTickTop,
} from "@/modules/zabbix/scale";
import type { ZabbixDashboardBody, ZabbixGraphView, ZabbixLineView } from "@/modules/zabbix/types";

const POLL_MS = 60_000;

export function ZabbixCharts() {
  const [body, setBody] = useState<ZabbixDashboardBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const response = await fetch("/api/dashboard/zabbix", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as ZabbixDashboardBody;
        if (!cancelled) setBody(next);
      } catch {
        if (!cancelled) {
          setBody({ status: "unavailable", message: "График Zabbix недоступен." });
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
  if (body == null) return <p className="text-muted-foreground text-sm">…</p>;
  if (body.status === "unavailable") {
    return <p className="text-muted-foreground text-sm">{body.message}</p>;
  }
  const origin = new Date(body.origin);
  if (Number.isNaN(origin.getTime())) {
    return <p className="text-muted-foreground text-sm">График Zabbix недоступен.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {body.graphs.map((graph) => (
        <ZabbixGraph key={graph.slot} graph={graph} origin={origin} />
      ))}
    </div>
  );
}

function ZabbixGraph({ graph, origin }: { graph: ZabbixGraphView; origin: Date }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines =
    graph.lines?.filter((line) => line.minutes.length === TWO_HOUR_MINUTES) ?? null;
  const drawn = lines && lines.length > 0 ? lines : null;
  const values = drawn ? drawn.flatMap((line) => line.minutes) : [];
  const scale = zabbixScale(values);
  const caption = drawn
    ? hoverCaption(origin, drawn, hover) ?? graph.host
    : graph.host;

  return (
    <section className="flex flex-col gap-2" aria-label={graph.title}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{graph.title}</h2>
        <p className="text-muted-foreground text-xs tabular-nums">{caption}</p>
        {graph.note ? <p className="text-muted-foreground text-xs">{graph.note}</p> : null}
      </div>
      {drawn ? (
        <div className="flex flex-col gap-2">
          <div className="flex">
            <div className="relative h-36 w-16 shrink-0">
              {scale.ticks.map((tick, index) => (
                <span
                  key={`${index}-${tick}`}
                  className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[10px] tabular-nums"
                  style={{ top: `${zabbixTickTop(tick, scale)}%` }}
                >
                  {formatZabbixNumber(tick)}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <ZabbixPlot
                lines={drawn}
                scale={scale}
                hover={hover}
                onHover={setHover}
                label={caption}
                zero={scale.min < 0 && scale.max > 0}
              />
              <div className="relative h-4">
                {chartTimeIndexes(TWO_HOUR_MINUTES).map((index) => (
                  <span
                    key={index}
                    className="text-muted-foreground absolute top-0 text-[10px] tabular-nums"
                    style={
                      index === 0
                        ? { left: 0 }
                        : {
                            left: `${(index / TWO_HOUR_MINUTES) * 100}%`,
                            transform: "translateX(-50%)",
                          }
                    }
                  >
                    {formatUtcMinute(origin, index)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {drawn.map((line) => (
              <li key={line.id} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: line.color }}
                />
                <span>
                  {line.label}
                  {line.unit ? ` · ${line.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-muted-foreground flex h-36 items-center text-sm">
          {graph.message ?? "Нет точек за два часа."}
        </div>
      )}
    </section>
  );
}

function hoverCaption(
  origin: Date,
  lines: readonly ZabbixLineView[],
  hover: number | null,
): string | null {
  if (hover == null) return null;
  const parts = lines.flatMap((line) => {
    const value = line.minutes[hover];
    if (value == null || !Number.isFinite(value)) return [];
    return [`${line.label} ${formatZabbixValue(value, line.unit)}`];
  });
  const clock = formatUtcMinute(origin, hover);
  if (parts.length === 0) return clock;
  return `${clock} · ${parts.join(" · ")}`;
}

function ZabbixPlot({
  lines,
  scale,
  hover,
  onHover,
  label,
  zero,
}: {
  lines: readonly ZabbixLineView[];
  scale: ReturnType<typeof zabbixScale>;
  hover: number | null;
  onHover: (minute: number | null) => void;
  label: string;
  zero: boolean;
}) {
  const span = TWO_HOUR_MINUTES;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    let minute = Math.floor(((event.clientX - rect.left) / rect.width) * span);
    if (minute === span) minute -= 1;
    if (minute < 0 || minute >= span) {
      onHover(null);
      return;
    }
    onHover(minute);
  };
  const zeroY = zabbixPlotY(0, scale);
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
      {scale.ticks.map((tick, index) => (
        <line
          key={`${index}-${tick}`}
          x1={0}
          x2={span}
          y1={zabbixPlotY(tick, scale)}
          y2={zabbixPlotY(tick, scale)}
          className="text-muted-foreground"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <ChartGapBands missing={missingMinutes(lines, TWO_HOUR_MINUTES, true)} />
      {zero ? (
        <line
          x1={0}
          x2={span}
          y1={zeroY}
          y2={zeroY}
          className="text-foreground"
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {lines.map((line) =>
        lineSegments(line.minutes).map((segment) => (
          <path
            key={`${line.id}-${segment.from}`}
            d={segmentPath(line.minutes, scale, segment.from, segment.to)}
            fill="none"
            stroke={line.color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {hover != null ? (
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
  scale: ReturnType<typeof zabbixScale>,
  from: number,
  to: number,
): string {
  const yAt = (index: number) => {
    const value = minutes[index] ?? 0;
    return zabbixPlotY(value, scale).toFixed(2);
  };
  let line = `M${from},${yAt(from)}L${from + 1},${yAt(from)}`;
  for (let index = from + 1; index < to; index += 1) {
    line += `L${index},${yAt(index)}L${index + 1},${yAt(index)}`;
  }
  return line;
}
