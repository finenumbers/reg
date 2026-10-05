"use client";

import { useEffect, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatUtcOffsetLabel } from "@/lib/display-timezone";
import { formatDatabaseGigabytes } from "@/lib/format-db-gigabytes";
import { formatDisplayClock, formatDisplayUtcDate } from "@/lib/format-display-time";
import { cn } from "@/lib/utils";

const CLOCK_WIDTH_SAMPLE = "00:00:00";
const DATE_WIDTH_SAMPLE = "31 сентября";
const DB_SIZE_WIDTH_SAMPLE = formatDatabaseGigabytes(1000 * 1024 ** 3);
const DB_SIZE_POLL_MS = 60_000;

function msUntilNextSecond(nowMs: number = Date.now()): number {
  const remainder = nowMs % 1000;
  return remainder === 0 ? 1000 : 1000 - remainder;
}

export function LiveClocks({ className }: { className?: string }) {
  const { timeZone } = useDisplayTimezone();
  const [now, setNow] = useState<Date | null>(null);
  const [dbBytes, setDbBytes] = useState<number | null>(null);

  useEffect(() => {
    let timer: number | null = null;

    const snap = () => {
      setNow(new Date());
    };

    const stop = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      stop();
      timer = window.setTimeout(() => {
        snap();
        schedule();
      }, msUntilNextSecond());
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      snap();
      schedule();
    };

    snap();
    if (document.visibilityState !== "hidden") schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const load = () => {
      void fetch("/api/db-size", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { bytes?: unknown };
          const bytes = Number(body.bytes);
          if (!stopped && Number.isFinite(bytes)) setDbBytes(bytes);
        })
        .catch(() => {
          /* Keep the last successful size. Clocks stay on their own timer. */
        });
    };

    const start = () => {
      load();
      stop();
      timer = window.setInterval(load, DB_SIZE_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      start();
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const utcDate = now ? formatDisplayUtcDate(now) : DATE_WIDTH_SAMPLE;
  const utc = now ? formatDisplayClock(now, "UTC") : CLOCK_WIDTH_SAMPLE;
  const local = now ? formatDisplayClock(now, timeZone) : CLOCK_WIDTH_SAMPLE;
  const iso = now?.toISOString();
  const utcDateTime = iso?.slice(0, 10);
  const localLabel = formatUtcOffsetLabel(timeZone);

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm whitespace-nowrap",
        className,
      )}
    >
      <span>Дата:</span>
      <time
        dateTime={utcDateTime}
        className={cn("font-bold text-black", !now && "invisible")}
      >
        {utcDate}
      </time>
      <span>UTC:</span>
      <time
        dateTime={iso}
        className={cn("font-bold text-black tabular-nums", !now && "invisible")}
      >
        {utc}
      </time>
      <span>{localLabel}:</span>
      <time
        dateTime={iso}
        className={cn("font-bold text-black tabular-nums", !now && "invisible")}
      >
        {local}
      </time>
      <span>БД:</span>
      <span
        className={cn(
          "font-bold text-black tabular-nums",
          dbBytes == null && "invisible",
        )}
      >
        {dbBytes == null ? DB_SIZE_WIDTH_SAMPLE : formatDatabaseGigabytes(dbBytes)}
      </span>
    </div>
  );
}
