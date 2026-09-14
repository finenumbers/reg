"use client";

import { useEffect, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatUtcOffsetLabel } from "@/lib/display-timezone";
import { formatDisplayClock } from "@/lib/format-display-time";
import { cn } from "@/lib/utils";

const CLOCK_WIDTH_SAMPLE = "00:00:00";

function msUntilNextSecond(nowMs: number = Date.now()): number {
  const remainder = nowMs % 1000;
  return remainder === 0 ? 1000 : 1000 - remainder;
}

export function LiveClocks({ className }: { className?: string }) {
  const { timeZone } = useDisplayTimezone();
  const [now, setNow] = useState<Date | null>(null);

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

  const utc = now ? formatDisplayClock(now, "UTC") : CLOCK_WIDTH_SAMPLE;
  const local = now ? formatDisplayClock(now, timeZone) : CLOCK_WIDTH_SAMPLE;
  const iso = now?.toISOString();
  const localLabel = formatUtcOffsetLabel(timeZone);

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 whitespace-nowrap text-sm",
        className,
      )}
    >
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
    </div>
  );
}
