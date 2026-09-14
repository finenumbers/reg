"use client";

import { useEffect, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
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

  return (
    <div className={cn("text-[12px] leading-tight", className)}>
      <p className="whitespace-nowrap">
        Время UTC:{" "}
        <time
          dateTime={iso}
          className={cn(
            "font-bold text-black tabular-nums",
            !now && "invisible",
          )}
        >
          {utc}
        </time>
      </p>
      <p className="whitespace-nowrap">
        Местное время:{" "}
        <time
          dateTime={iso}
          className={cn(
            "font-bold text-black tabular-nums",
            !now && "invisible",
          )}
        >
          {local}
        </time>
      </p>
    </div>
  );
}
