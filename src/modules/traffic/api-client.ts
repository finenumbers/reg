import {
  encodeFilters,
  type ColumnFilters,
} from "@/components/column-filters/types";
import {
  interpretSyncResponse,
  type SyncApiResult,
} from "@/modules/phones/request-action";
import type {
  ListTrafficResult,
  TrafficOperationalStatus,
} from "@/modules/traffic/service";

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return fallback;
}

export function buildTrafficListUrl(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.month?.trim()) params.set("month", opts.month.trim());
  if (opts.phantom) params.set("phantom", "1");
  if (opts.callErrors) params.set("callErrors", "1");
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return qs ? `/api/traffic?${qs}` : "/api/traffic";
}

export function buildTrafficFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.month?.trim()) params.set("month", opts.month.trim());
  if (opts.phantom) params.set("phantom", "1");
  if (opts.callErrors) params.set("callErrors", "1");
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/traffic/facets?${params.toString()}`;
}

export async function fetchTrafficList(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ ok: true; data: ListTrafficResult } | { ok: false; message: string }> {
  const res = await fetch(buildTrafficListUrl(opts), { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, message: errorMessage(body, "Не удалось загрузить трафик") };
  }
  return { ok: true, data: body as ListTrafficResult };
}

export async function fetchTrafficStatus(): Promise<
  { ok: true; data: TrafficOperationalStatus } | { ok: false; message: string }
> {
  const res = await fetch("/api/traffic/status", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, message: errorMessage(body, "Не удалось загрузить статус") };
  }
  return { ok: true, data: body as TrafficOperationalStatus };
}

export async function postTrafficRetry(): Promise<SyncApiResult> {
  const res = await fetch("/api/traffic/retry", { method: "POST" });
  const body = (await readJson(res)) as {
    accepted?: boolean;
    message?: string;
    reason?: string;
    error?: string;
    code?: string;
    retryAfterSec?: number;
  } | null;
  return interpretSyncResponse(res.status, body);
}
