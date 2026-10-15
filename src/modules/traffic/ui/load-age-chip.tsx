"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatElapsed,
  loadAgeStateLabel,
  passTone,
  type LoadTone,
} from "@/modules/traffic/load-age";

const TONE_CLASS: Record<LoadTone, string> = {
  green: "text-green-600 dark:text-green-500",
  yellow: "text-amber-500",
  red: "text-red-600 dark:text-red-500",
};

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatInstant(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LoadAgeChip({
  lastPassAt,
  hadCalls = false,
  lastCheckedAt = null,
  colored,
}: {
  lastPassAt: string | null;
  hadCalls?: boolean;
  lastCheckedAt?: string | null;
  colored: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const passAt = parseInstant(lastPassAt);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lastPassAt, lastCheckedAt]);

  if (passAt == null) {
    return <p className="text-muted-foreground text-sm">нет загрузок</p>;
  }

  const tone = colored
    ? passTone({
        lastPassAt: passAt,
        hadCalls,
        lastCheckedAt: parseInstant(lastCheckedAt),
      })
    : null;
  const state = loadAgeStateLabel(tone);
  const when = formatInstant(passAt);
  const title = state ? `${state}. ${when}` : when;

  return (
    <p className="text-muted-foreground text-sm" title={title}>
      с последней загрузки:{" "}
      <span className={cn("font-semibold tabular-nums", tone ? TONE_CLASS[tone] : null)}>
        {formatElapsed(now - passAt)}
      </span>
    </p>
  );
}
