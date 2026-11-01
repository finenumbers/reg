/**
 * First-page size fallback for catalog XLSX. The list call itself never
 * retries: a later page number has to match the size that was accepted.
 */

import { DidClientError } from "@/modules/did/client";
import { NumberingClientError } from "@/modules/numbering-resource/errors";

export const CATALOG_EXPORT_PAGE_SIZE = 500;

const CATALOG_PAGE_FALLBACKS = [200, 100] as const;

/** Previous PSTN page cap. One step down from 500, then the size stays. */
export const NUMBERING_EXPORT_PAGE_FALLBACK = 200;

/**
 * Next size after a page_size rejection. `limit` is DID's announced maximum.
 * `null` means the 422 named page_size and gave no usable maximum, so the
 * fixed steps apply. A limit that is not smaller than the current request
 * is not a step down.
 */
export function nextCatalogPageSize(current: number, limit: number | null): number | null {
  if (limit != null && Number.isFinite(limit)) {
    const cap = Math.floor(limit);
    if (cap >= 1 && cap < current) return cap;
    return null;
  }
  for (const step of CATALOG_PAGE_FALLBACKS) {
    if (current > step) return step;
  }
  return null;
}

/** Null when this error must fail the file instead of shrinking the page. */
export function catalogRetryPageSize(current: number, error: unknown): number | null {
  if (!(error instanceof DidClientError)) return null;
  if (error.httpStatus !== 422 || error.pageSizeLimit === undefined) return null;
  return nextCatalogPageSize(current, error.pageSizeLimit);
}

/**
 * Load one catalog page. Shrinks only on the first page, and only after a
 * page_size 422. The returned size is the one that succeeded. A timeout or
 * any other error leaves the caller's size unchanged.
 */
export async function loadCatalogPage<T>(opts: {
  page: number;
  pageSize: number;
  load: (pageSize: number) => Promise<T>;
}): Promise<{ value: T; pageSize: number }> {
  let size = opts.pageSize;
  for (;;) {
    try {
      const value = await opts.load(size);
      return { value, pageSize: size };
    } catch (error) {
      if (opts.page !== 1) throw error;
      const next = catalogRetryPageSize(size, error);
      if (next == null) throw error;
      size = next;
    }
  }
}

/**
 * Load one numbering page. A 400 on the first cursor page is tried once at
 * 200. A second 400 is the original error. A timeout on that try stays a
 * timeout. Later pages do not change size.
 */
export async function loadNumberingExportPage<T>(opts: {
  cursor: string | null;
  pageSize: number;
  load: (pageSize: number) => Promise<T>;
}): Promise<{ value: T; pageSize: number }> {
  try {
    return { value: await opts.load(opts.pageSize), pageSize: opts.pageSize };
  } catch (error) {
    if (opts.cursor != null || opts.pageSize <= NUMBERING_EXPORT_PAGE_FALLBACK) throw error;
    if (!(error instanceof NumberingClientError) || error.httpStatus !== 400) throw error;
    try {
      return {
        value: await opts.load(NUMBERING_EXPORT_PAGE_FALLBACK),
        pageSize: NUMBERING_EXPORT_PAGE_FALLBACK,
      };
    } catch (retryError) {
      if (retryError instanceof NumberingClientError && retryError.httpStatus === 400) {
        throw error;
      }
      throw retryError;
    }
  }
}
