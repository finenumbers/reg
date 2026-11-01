/**
 * Browser fetch helpers for the purchased-numbers table.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { ListPurchasedNumbersResult } from "@/modules/purchased-numbers/format";

export type FetchPurchasedNumbersResult =
  | { ok: true; data: ListPurchasedNumbersResult }
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

export function buildPurchasedNumbersListUrl(opts: {
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
  return query ? `/api/purchased-numbers?${query}` : "/api/purchased-numbers";
}

export function buildPurchasedNumbersFacetsUrl(opts: {
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
  return `/api/purchased-numbers/facets?${params.toString()}`;
}

export async function fetchPurchasedNumbersList(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  page?: number;
  pageSize?: number;
}): Promise<FetchPurchasedNumbersResult> {
  const res = await fetch(buildPurchasedNumbersListUrl(opts), {
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
          ? "Недостаточно прав для просмотра купленных номеров"
          : "Не удалось загрузить купленные номера",
      ),
    };
  }
  return { ok: true, data: body as ListPurchasedNumbersResult };
}

export type { FacetResponse };
