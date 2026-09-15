"use client";

import { useEffect, useRef } from "react";
import { fetchRegsStatus } from "@/modules/registrations/api-client";

/** Registrations is the fresher surface — poll status more often. */
export const REGS_UNREGISTERED_POLL_MS = 4000;
/** Phones only displays the same N; slower interval is enough. */
export const PHONES_REGS_UNREGISTERED_POLL_MS = 12000;

export type RegsUnregisteredWatchState = {
  /** undefined = not primed; null = never succeeded. */
  lastSuccessAt: string | null | undefined;
};

export type RegsUnregisteredWatchEvent =
  | {
      ok: true;
      unregisteredCount: number;
      lastSuccessAt: string | null;
    }
  | { ok: false };

export type RegsUnregisteredWatchResult = {
  count: number | null;
  snapshot: boolean;
  next: RegsUnregisteredWatchState;
};

/**
 * Pure watch step: every ok tick yields the live count.
 * List reload only when lastSuccessAt changes after the first baseline,
 * and never while a manual poll is in flight.
 */
export function reduceRegsUnregisteredWatch(
  state: RegsUnregisteredWatchState,
  event: RegsUnregisteredWatchEvent,
  opts: { pollInFlight?: boolean } = {},
): RegsUnregisteredWatchResult {
  if (!event.ok) {
    return { count: null, snapshot: false, next: state };
  }

  const incoming = event.lastSuccessAt;
  if (state.lastSuccessAt === undefined) {
    return {
      count: event.unregisteredCount,
      snapshot: false,
      next: { lastSuccessAt: incoming },
    };
  }

  const changed = state.lastSuccessAt !== incoming;
  return {
    count: event.unregisteredCount,
    snapshot: changed && !opts.pollInFlight,
    next: { lastSuccessAt: incoming },
  };
}

export function useRegsUnregisteredCount(opts: {
  intervalMs: number;
  pollInFlight?: () => boolean;
  onCount: (n: number) => void;
  onSnapshot: () => void;
}): void {
  const onCountRef = useRef(opts.onCount);
  const onSnapshotRef = useRef(opts.onSnapshot);
  const pollInFlightRef = useRef(opts.pollInFlight);
  onCountRef.current = opts.onCount;
  onSnapshotRef.current = opts.onSnapshot;
  pollInFlightRef.current = opts.pollInFlight;

  const intervalMs = opts.intervalMs;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let watch: RegsUnregisteredWatchState = { lastSuccessAt: undefined };

    const pull = async () => {
      const status = await fetchRegsStatus();
      if (cancelled) return;
      const result = reduceRegsUnregisteredWatch(
        watch,
        status.ok
          ? {
              ok: true,
              unregisteredCount: status.data.unregisteredCount,
              lastSuccessAt: status.data.lastSuccessAt,
            }
          : { ok: false },
        { pollInFlight: pollInFlightRef.current?.() ?? false },
      );
      watch = result.next;
      if (result.count != null) onCountRef.current(result.count);
      if (result.snapshot) onSnapshotRef.current();
    };

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (cancelled || timer != null) return;
      timer = window.setInterval(() => {
        void pull();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void pull();
      start();
    };

    void pull();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
