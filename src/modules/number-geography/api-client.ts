/**
 * Browser fetch helpers for the number geography table.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { PstnFillResponse } from "@/modules/number-geography/pstn-fill-contract";
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
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.blockedOnly) params.set("blockedOnly", "1");
  if (opts.unregisteredOnly) params.set("unregisteredOnly", "1");
  if (opts.missingOnly) params.set("missingOnly", "1");
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const query = params.toString();
  return query ? `/api/number-geography?${query}` : "/api/number-geography";
}

export function buildNumberGeographyFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.blockedOnly) params.set("blockedOnly", "1");
  if (opts.unregisteredOnly) params.set("unregisteredOnly", "1");
  if (opts.missingOnly) params.set("missingOnly", "1");
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/number-geography/facets?${params.toString()}`;
}

export async function fetchNumberGeographyList(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
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

export async function fetchNumberGeographyPstnFill(
  ids: string[],
): Promise<{ ok: true; data: PstnFillResponse } | { ok: false }> {
  try {
    const res = await fetch("/api/number-geography/pstn-fill", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
      cache: "no-store",
    });
    const body = await readJson(res);
    if (!res.ok || !body || typeof body !== "object" || !("configured" in body)) {
      return { ok: false };
    }
    return { ok: true, data: body as PstnFillResponse };
  } catch {
    return { ok: false };
  }
}

export type { FacetResponse };
