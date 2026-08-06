"use client";

import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export function formatTableShownCount(shown: number, total: number): string {
  if (total === 0) return "0 результатов";
  return `Показано ${shown} из ${total}`;
}

type TableInfiniteBodyProps = {
  scrollRef: Ref<HTMLDivElement>;
  sentinelRef: (node: HTMLElement | null) => void;
  loadingMore?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Scrollable table region + load-more sentinel.
 * Pair with TableCountFooter outside this element so counts stay visible.
 */
export function TableInfiniteBody({
  scrollRef,
  sentinelRef,
  loadingMore = false,
  className,
  children,
}: TableInfiniteBodyProps) {
  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 flex-1 overflow-auto", className)}
    >
      {children}
      {loadingMore ? (
        <p className="py-2 text-sm text-muted-foreground">Загрузка…</p>
      ) : null}
      <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
    </div>
  );
}

type TableCountFooterProps = {
  shown: number;
  total: number;
  className?: string;
};

/** Always-visible count bar for infinite-scroll tables (no card chrome). */
export function TableCountFooter({
  shown,
  total,
  className,
}: TableCountFooterProps) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border/60 pt-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <p>{formatTableShownCount(shown, total)}</p>
    </div>
  );
}
