"use client";

import { useCallback, useEffect, useRef } from "react";

export type UseInfiniteScrollOptions = {
  /** When false, observer is idle (e.g. no more pages or initial load). */
  enabled: boolean;
  /** Called when the sentinel enters the scroll root (or viewport). */
  onLoadMore: () => void;
  /**
   * Scroll container for IntersectionObserver.
   * Pass the table scroll area element when the list does not scroll the window.
   */
  root?: Element | null;
  /** IntersectionObserver rootMargin. */
  rootMargin?: string;
};

/**
 * IntersectionObserver-based infinite scroll sentinel.
 * Returns a callback ref to attach to the element below the list.
 */
export function useInfiniteScroll({
  enabled,
  onLoadMore,
  root = null,
  rootMargin = "200px",
}: UseInfiniteScrollOptions): (node: HTMLElement | null) => void {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  const disconnect = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const observe = useCallback(
    (node: HTMLElement | null) => {
      disconnect();
      nodeRef.current = node;
      if (!node || !enabled) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting) {
            onLoadMoreRef.current();
          }
        },
        { root: root ?? null, rootMargin, threshold: 0 },
      );
      observerRef.current.observe(node);
    },
    [disconnect, enabled, root, rootMargin],
  );

  useEffect(() => {
    observe(nodeRef.current);
    return disconnect;
  }, [observe, disconnect]);

  return observe;
}
