/**
 * Browser fetch helpers. The PSTN origin stays on the server.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type {
  ListNumberingResult,
  NumberingSummary,
} from "@/modules/numbering-resource/types";

export type FetchNumberingResult<T> =
  | { ok: true; data: T }
  | { ok: false; aborted: boolean; status: number; message: string };

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return fallback;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function searchParams(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  return params;
}

export function buildNumberingListUrl(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  cursor?: string | null;
}): string {
  const params = searchParams(opts);
  if (opts.cursor) params.set("cursor", opts.cursor);
  const query = params.toString();
  return query ? `/api/numbering-resource?${query}` : "/api/numbering-resource";
}

export function buildNumberingFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  q?: string;
}): string {
  const params = searchParams(opts);
  params.set("column", opts.column);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  return `/api/numbering-resource/facets?${params.toString()}`;
}

export function buildNumberingSummaryUrl(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
}): string {
  const params = searchParams(opts);
  const query = params.toString();
  return query
    ? `/api/numbering-resource/summary?${query}`
    : "/api/numbering-resource/summary";
}

async function getJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<FetchNumberingResult<T>> {
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal });
    if (res.status === 499) {
      return { ok: false, aborted: true, status: 499, message: "" };
    }
    const body = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        aborted: false,
        status: res.status,
        message: errorMessage(body, "Не удалось прочитать ресурс нумерации."),
      };
    }
    return { ok: true, data: body as T };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, aborted: true, status: 499, message: "" };
    }
    return {
      ok: false,
      aborted: false,
      status: 0,
      message: "Не удалось прочитать ресурс нумерации.",
    };
  }
}

export function fetchNumberingList(
  opts: { filters?: ColumnFilters; phoneQ?: string; cursor?: string | null },
  signal?: AbortSignal,
): Promise<FetchNumberingResult<ListNumberingResult>> {
  return getJson(buildNumberingListUrl(opts), signal);
}

export function fetchNumberingSummary(
  opts: { filters?: ColumnFilters; phoneQ?: string },
  signal?: AbortSignal,
): Promise<FetchNumberingResult<NumberingSummary>> {
  return getJson(buildNumberingSummaryUrl(opts), signal);
}
