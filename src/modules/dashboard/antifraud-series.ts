/**
 * Pure shaping for the three antifraud charts.
 * SQL lives in antifraud-query.ts. This file does not touch the database.
 */

import { AF_CATEGORY } from "@/modules/smg-trace/classify";
import {
  fillEventCounts,
  type MinuteCountRow,
  type UtcCallWindow,
} from "@/modules/dashboard/concurrency";
import type { DashboardChartLine, DashboardLineTone } from "@/modules/dashboard/types";

/** Widest offset in the curated CDR zone list. Novosibirsk is UTC+7, and none observe DST. */
export const CDR_ZONE_MAX_OFFSET_MS = 7 * 60 * 60 * 1000;

const ANSWER_TONE: Record<keyof typeof AF_CATEGORY, DashboardLineTone> = {
  waiting: "amber",
  noData: "zinc",
  notChecked: "stone",
  notSent: "slate",
  requestMissing: "orange",
  passed: "emerald",
  passedIn: "green",
  passedOut: "teal",
  blockedIn: "red",
  blockedOut: "rose",
  rejectIgnoredIn: "violet",
  rejectIgnoredOut: "purple",
  rejectIgnoredBoth: "fuchsia",
  noReply: "sky",
  releasedNoReply: "blue",
  conflict: "pink",
};

export const AF_ANSWER_ORDER: ReadonlyArray<{
  id: keyof typeof AF_CATEGORY;
  category: string;
  tone: DashboardLineTone;
}> = (Object.keys(ANSWER_TONE) as Array<keyof typeof AF_CATEGORY>).map((id) => ({
  id,
  category: AF_CATEGORY[id],
  tone: ANSWER_TONE[id],
}));

export const DELAY_LINES = [
  { id: "dev", label: "Dev", tone: "emerald" },
  { id: "prod", label: "Prod", tone: "blue" },
  { id: "parking", label: "Parking", tone: "red" },
] as const;

export function widenedSetupBounds(bounds: UtcCallWindow): {
  start: string;
  end: string;
} {
  const fromMs = Math.min(bounds.dayStart.getTime(), bounds.recentStart.getTime());
  const toMs = bounds.seriesEnd.getTime() + CDR_ZONE_MAX_OFFSET_MS;
  return { start: civilUtc(fromMs), end: civilUtc(toMs) };
}

export function zoneCacheKey(
  nodes: readonly { identifier: string | null; cdrTimezone: string }[],
): string {
  return nodes
    .flatMap((node) =>
      node.identifier ? [`${node.identifier}=${node.cdrTimezone}`] : [],
    )
    .sort()
    .join("|");
}

/** Consecutive non-null runs. A zero is a point. A null breaks the line. */
export function lineSegments(
  minutes: readonly (number | null)[],
): Array<{ from: number; to: number }> {
  const segments: Array<{ from: number; to: number }> = [];
  let from: number | null = null;
  for (let index = 0; index <= minutes.length; index += 1) {
    const gap = index === minutes.length || minutes[index] == null;
    if (gap) {
      if (from != null) segments.push({ from, to: index });
      from = null;
    } else if (from == null) {
      from = index;
    }
  }
  return segments;
}

export function buildAnswerLines(
  minuteCount: number,
  rows: readonly { category: string; minute: number; count: number }[],
): DashboardChartLine[] {
  const grouped = new Map<string, MinuteCountRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.category) ?? [];
    list.push({ minute: row.minute, count: row.count });
    grouped.set(row.category, list);
  }
  const lines: DashboardChartLine[] = [];
  const known = new Set<string>();
  for (const item of AF_ANSWER_ORDER) {
    known.add(item.category);
    const minutes = fillEventCounts(minuteCount, grouped.get(item.category) ?? []);
    const total = minutes.reduce((sum, value) => sum + value, 0);
    if (total === 0) continue;
    lines.push({ id: item.id, label: item.category, tone: item.tone, minutes, total });
  }
  for (const [category, counts] of grouped) {
    if (known.has(category)) continue;
    const minutes = fillEventCounts(minuteCount, counts);
    const total = minutes.reduce((sum, value) => sum + value, 0);
    if (total === 0) continue;
    lines.push({
      id: `other:${category}`,
      label: category,
      tone: "zinc",
      minutes,
      total,
    });
  }
  return lines;
}

export function buildDelayLines(
  minuteCount: number,
  rows: readonly { line: string; minute: number; mean: number }[],
): DashboardChartLine[] {
  const count = Math.max(0, Math.trunc(minuteCount));
  return DELAY_LINES.map((item) => {
    const minutes: Array<number | null> = new Array(count).fill(null);
    for (const row of rows) {
      if (row.line !== item.id) continue;
      if (row.minute >= 0 && row.minute < count) minutes[row.minute] = row.mean;
    }
    return { id: item.id, label: item.label, tone: item.tone, minutes, total: null };
  });
}

export function envelopeMinutes(
  lines: readonly DashboardChartLine[],
  minuteCount: number,
): number[] {
  const count = Math.max(0, Math.trunc(minuteCount));
  const minutes = new Array<number>(count).fill(0);
  for (const line of lines) {
    line.minutes.forEach((value, index) => {
      if (index < count && value != null && value > (minutes[index] ?? 0)) {
        minutes[index] = value;
      }
    });
  }
  return minutes;
}

export function linesPeak(lines: readonly DashboardChartLine[]): number {
  let peak = 0;
  for (const line of lines) {
    for (const value of line.minutes) {
      if (value != null && value > peak) peak = value;
    }
  }
  return peak;
}

function civilUtc(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}
