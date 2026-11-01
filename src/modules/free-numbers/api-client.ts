/**
 * Browser fetch helpers for the free-numbers table.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { ListFreeNumbersResult } from "@/modules/free-numbers/format";

export type FetchFreeNumbersResult =
  | { ok: true; data: ListFreeNumbersResult }
  | { ok: false; status: number; message: string };

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

export function buildFreeNumbersListUrl(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const query = params.toString();
  return query ? `/api/free-numbers?${query}` : "/api/free-numbers";
}

export function buildFreeNumbersFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/free-numbers/facets?${params.toString()}`;
}

export async function fetchFreeNumbersList(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  page?: number;
  pageSize?: number;
}): Promise<FetchFreeNumbersResult> {
  const res = await fetch(buildFreeNumbersListUrl(opts), {
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(
        body,
        res.status === 403
          ? "Недостаточно прав для просмотра свободных номеров"
          : "Не удалось загрузить свободные номера",
      ),
    };
  }
  return { ok: true, data: body as ListFreeNumbersResult };
}

export type { FacetResponse };
