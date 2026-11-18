/**
 * First-page size fallback for the PSTN numbering XLSX. The list call itself never
 * retries: a later page number has to match the size that was accepted.
 */

import { NumberingClientError } from "@/modules/numbering-resource/errors";

/** Previous PSTN page cap. One step down from 500, then the size stays. */
export const NUMBERING_EXPORT_PAGE_FALLBACK = 200;

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
