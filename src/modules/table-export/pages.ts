/**
 * Page walks for the PSTN numbering export. The cursor page decides the stop.
 */

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
  return false;
}

async function loadPageOnceMore<T>(
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
