"use client";

import { useEffect, useRef } from "react";

export type StampWatchState = {
  /** undefined = not primed yet. */
  stamp: string | null | undefined;
  pending: boolean;
};

export type StampWatchEvent = { ok: true; stamp: string | null } | { ok: false };

export type StampWatchResult = {
  reload: boolean;
  next: StampWatchState;
};

/**
 * Reload when the catalog stamp changes. A pause keeps the reload pending
 * so the next idle tick still applies it.
 */
export function reduceStampWatch(
  state: StampWatchState,
  event: StampWatchEvent,
  opts: { paused?: boolean } = {},
): StampWatchResult {
  if (!event.ok) return { reload: false, next: state };
  if (state.stamp === undefined && !state.pending) {
    return {
      reload: false,
      next: { stamp: event.stamp, pending: false },
    };
  }
  const reload = state.pending || state.stamp !== event.stamp;
  if (reload && opts.paused) {
    return {
      reload: false,
      next: { stamp: event.stamp, pending: true },
    };
  }
  return {
    reload,
    next: { stamp: event.stamp, pending: false },
  };
}

export function useStampRefresh(opts: {
  intervalMs: number;
  initialStamp: string | null;
  paused?: () => boolean;
  pull: () => Promise<StampWatchEvent>;
  onReload: () => void;
}): void {
  const pausedRef = useRef(opts.paused);
  const pullRef = useRef(opts.pull);
  const onReloadRef = useRef(opts.onReload);
  const initialStampRef = useRef(opts.initialStamp);
  pausedRef.current = opts.paused;
  pullRef.current = opts.pull;
  onReloadRef.current = opts.onReload;

  const intervalMs = opts.intervalMs;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let watch: StampWatchState = {
      stamp: initialStampRef.current,
      pending: false,
    };

    const tick = async () => {
      const event = await pullRef.current();
      if (cancelled) return;
      const result = reduceStampWatch(watch, event, {
        paused: pausedRef.current?.() ?? false,
      });
      watch = result.next;
      if (result.reload) onReloadRef.current();
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
        void tick();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void tick();
      start();
    };

    if (document.visibilityState !== "hidden") {
      void tick();
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
