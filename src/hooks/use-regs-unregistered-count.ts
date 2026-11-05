"use client";

import { useEffect, useRef } from "react";
import type { SyncSnapshot } from "@/modules/jobs/sync-line";
import { fetchRegsStatus } from "@/modules/registrations/api-client";

/** Registrations is the fresher surface — poll status more often. */
export const REGS_UNREGISTERED_POLL_MS = 4000;
/** Phones only displays the same N; slower interval is enough. */
export const PHONES_REGS_UNREGISTERED_POLL_MS = 12000;

export type RegsUnregisteredWatchState = {
  /** undefined = not primed; null = never succeeded. */
  lastSuccessAt: string | null | undefined;
  /** A changed stamp arrived while the list could not reload. */
  pending?: boolean;
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
 * List reload only when lastSuccessAt changes after the first baseline.
 * A pause or an in-flight poll keeps that reload pending.
 */
export function reduceRegsUnregisteredWatch(
  state: RegsUnregisteredWatchState,
  event: RegsUnregisteredWatchEvent,
  opts: { pollInFlight?: boolean; paused?: boolean } = {},
): RegsUnregisteredWatchResult {
  if (!event.ok) {
    return { count: null, snapshot: false, next: state };
  }

  const incoming = event.lastSuccessAt;
  if (state.lastSuccessAt === undefined && !state.pending) {
    return {
      count: event.unregisteredCount,
      snapshot: false,
      next: { lastSuccessAt: incoming, pending: false },
    };
  }

  const want = state.pending === true || state.lastSuccessAt !== incoming;
  const blocked = opts.pollInFlight === true || opts.paused === true;
  if (want && blocked) {
    return {
      count: event.unregisteredCount,
      snapshot: false,
      next: { lastSuccessAt: incoming, pending: true },
    };
  }
  return {
    count: event.unregisteredCount,
    snapshot: want,
    next: { lastSuccessAt: incoming, pending: false },
  };
}

export function useRegsUnregisteredCount(opts: {
  intervalMs: number;
  /** When set, including null, the first tick can reload. Omitted means unprimed. */
  initialLastSuccessAt?: string | null;
  pollInFlight?: () => boolean;
  paused?: () => boolean;
  onCount: (n: number) => void;
  onSnapshot: () => void;
  onSync?: (sync: SyncSnapshot) => void;
}): void {
  const onCountRef = useRef(opts.onCount);
  const onSnapshotRef = useRef(opts.onSnapshot);
  const onSyncRef = useRef(opts.onSync);
  const pollInFlightRef = useRef(opts.pollInFlight);
  const pausedRef = useRef(opts.paused);
  const initialLastSuccessAtRef = useRef(opts.initialLastSuccessAt);
  onCountRef.current = opts.onCount;
  onSnapshotRef.current = opts.onSnapshot;
  onSyncRef.current = opts.onSync;
  pollInFlightRef.current = opts.pollInFlight;
  pausedRef.current = opts.paused;

  const intervalMs = opts.intervalMs;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let watch: RegsUnregisteredWatchState =
      initialLastSuccessAtRef.current === undefined
        ? { lastSuccessAt: undefined, pending: false }
        : { lastSuccessAt: initialLastSuccessAtRef.current, pending: false };

    const pull = async () => {
      const status = await fetchRegsStatus();
      if (cancelled) return;
      if (status.ok && status.data.sync) onSyncRef.current?.(status.data.sync);
      const result = reduceRegsUnregisteredWatch(
        watch,
        status.ok
          ? {
              ok: true,
              unregisteredCount: status.data.unregisteredCount,
              lastSuccessAt: status.data.lastSuccessAt,
            }
          : { ok: false },
        {
          pollInFlight: pollInFlightRef.current?.() ?? false,
          paused: pausedRef.current?.() ?? false,
        },
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

    if (document.visibilityState !== "hidden") {
      void pull();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
