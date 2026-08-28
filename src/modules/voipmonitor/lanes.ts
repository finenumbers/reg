import { GRACE_MS, LIVE_PRIORITY_MS } from "@/modules/voipmonitor/constants";

export type MatchLane = "live" | "archive";

export function liveCutoffAt(now: Date): Date {
  return new Date(now.getTime() - LIVE_PRIORITY_MS);
}

export function graceCutoffAt(now: Date): Date {
  return new Date(now.getTime() - GRACE_MS);
}

/** Inclusive lower / exclusive upper for eligible `cdrAt` in this hour + lane. */
export function laneCdrAtWhere(
  hour: Date,
  hourEnd: Date,
  lane: MatchLane,
  now: Date,
): { gte: Date; lt: Date } {
  const liveCutoff = liveCutoffAt(now);
  if (lane === "live") {
    const gte = liveCutoff > hour ? liveCutoff : hour;
    return { gte, lt: hourEnd };
  }
  const lt = liveCutoff < hourEnd ? liveCutoff : hourEnd;
  return { gte: hour, lt };
}
