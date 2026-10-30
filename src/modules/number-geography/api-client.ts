/**
 * Browser fetch helpers for the number geography table.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { ListNumberGeographyResult } from "@/modules/number-geography/types";

export type FetchNumberGeographyResult =
  | { ok: true; data: ListNumberGeographyResult }
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

export function buildNumberGeographyListUrl(opts: {
  filters?: ColumnFilters;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const query = params.toString();
  return query ? `/api/number-geography?${query}` : "/api/number-geography";
}

export function buildNumberGeographyFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/number-geography/facets?${params.toString()}`;
}

export async function fetchNumberGeographyList(opts: {
  filters?: ColumnFilters;
  page?: number;
  pageSize?: number;
}): Promise<FetchNumberGeographyResult> {
  const res = await fetch(buildNumberGeographyListUrl(opts), {
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
          ? "Недостаточно прав для просмотра географии номеров"
          : "Не удалось загрузить географию номеров",
      ),
    };
  }
  return { ok: true, data: body as ListNumberGeographyResult };
}

export type { FacetResponse };
