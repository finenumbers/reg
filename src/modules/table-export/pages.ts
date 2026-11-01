/**
 * Page walks for the three catalog exports. The stop is the page itself.
 * A negative total, which PSTN sends for a phone mask, does not end the walk.
 */

import { DidClientError } from "@/modules/did/client";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import { TableExportCancelled } from "@/modules/table-export/xlsx-stream";

const RATE_WAIT_CAP_MS = 5_000;

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(new TableExportCancelled());
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TableExportCancelled());
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new TableExportCancelled());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Immediate retry on a DID timeout. Cancel is not a timeout. */
export function didRetryDelayMs(error: unknown): number | null {
  if (error instanceof DidClientError && error.code === "TIMEOUT") return 0;
  return null;
}

/** One pause on PSTN 429, capped, or an immediate retry on a timeout. */
export function pstnRetryDelayMs(error: unknown): number | null {
  if (!(error instanceof NumberingClientError)) return null;
  if (error.code === "TIMEOUT") return 0;
  if (error.code === "RATE_LIMITED") {
    const seconds = error.retryAfterSec ?? 1;
    return Math.min(RATE_WAIT_CAP_MS, Math.max(0, seconds) * 1000);
  }
  return null;
}

export function isTableExportCancel(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof TableExportCancelled) return true;
  if (error instanceof NumberingClientError && error.code === "ABORTED") return true;
  if (error instanceof DidClientError && error.code === "ABORTED") return true;
  return false;
}

export async function loadPageOnceMore<T>(
  signal: AbortSignal | undefined,
  load: () => Promise<T>,
  delayMs: (error: unknown) => number | null,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (signal?.aborted) throw error;
    const wait = delayMs(error);
    if (wait == null) throw error;
    if (wait > 0) await sleep(wait, signal);
    return await load();
  }
}

export async function drainCursorPages<T>(opts: {
  signal?: AbortSignal;
  load: (cursor: string | null) => Promise<{
    items: readonly T[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  retryDelayMs: (error: unknown) => number | null;
  onPage: (items: readonly T[]) => void | Promise<void>;
}): Promise<void> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (;;) {
    if (opts.signal?.aborted) throw new TableExportCancelled();
    const page = await loadPageOnceMore(
      opts.signal,
      () => opts.load(cursor),
      opts.retryDelayMs,
    );
    if (opts.signal?.aborted) throw new TableExportCancelled();
    if (page.items.length === 0) return;
    await opts.onPage(page.items);
    if (!page.hasMore || !page.nextCursor) return;
    if (seen.has(page.nextCursor) || page.nextCursor === cursor) return;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
    await yieldEventLoop();
  }
}

function acceptedPageSize(reported: number | undefined, requested: number): number {
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 1) {
    return Math.floor(reported);
  }
  return requested;
}

export async function drainOffsetPages<T>(opts: {
  signal?: AbortSignal;
  pageSize: number;
  load: (page: number) => Promise<{ items: readonly T[]; total: number; pageSize?: number }>;
  retryDelayMs: (error: unknown) => number | null;
  onTotal?: (total: number) => void;
  onPage: (items: readonly T[]) => void | Promise<void>;
}): Promise<void> {
  let page = 1;
  for (;;) {
    if (opts.signal?.aborted) throw new TableExportCancelled();
    const result = await loadPageOnceMore(
      opts.signal,
      () => opts.load(page),
      opts.retryDelayMs,
    );
    if (opts.signal?.aborted) throw new TableExportCancelled();
    if (page === 1) opts.onTotal?.(result.total);
    if (result.items.length === 0) return;
    await opts.onPage(result.items);
    const size = acceptedPageSize(result.pageSize, opts.pageSize);
    if (result.items.length < size) return;
    if (result.total >= 0 && page * size >= result.total) return;
    page += 1;
    await yieldEventLoop();
  }
}
