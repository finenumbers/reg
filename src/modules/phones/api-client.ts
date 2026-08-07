/**
 * Browser fetch helpers for phones APIs.
 */

import {
  encodeFilters,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type {
  ListPhonesResult,
  PhonesOperationalStatus,
} from "@/modules/phones/service";
import type { PhoneKind } from "@/modules/phones/types";
import {
  interpretSyncResponse,
  type PhonesSyncStatusSnapshot,
  type SyncApiResult,
} from "@/modules/phones/request-action";
import {
  downloadXlsxFromUrl,
  type DownloadXlsxResult,
} from "@/lib/download-xlsx";

export type FetchPhonesListResult =
  | { ok: true; data: ListPhonesResult }
  | { ok: false; status: number; message: string };

export type FetchPhonesStatusResult =
  | { ok: true; data: PhonesOperationalStatus }
  | { ok: false; status: number; message: string };

export type FetchPhonesFacetsResult =
  | { ok: true; data: FacetResponse }
  | { ok: false; status: number; message: string };

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

export function buildPhonesListUrl(opts: {
  kind: PhoneKind;
  filters?: ColumnFilters;
  phoneQ?: string;
  sipUnregisteredOnly?: boolean;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  params.set("kind", opts.kind);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.sipUnregisteredOnly) params.set("sipUnregisteredOnly", "1");
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  return `/api/phones?${params.toString()}`;
}

export function buildPhonesFacetsUrl(opts: {
  kind: PhoneKind;
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  sipUnregisteredOnly?: boolean;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("kind", opts.kind);
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.sipUnregisteredOnly) params.set("sipUnregisteredOnly", "1");
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/phones/facets?${params.toString()}`;
}

export async function fetchPhonesList(
  opts: {
    kind: PhoneKind;
    filters?: ColumnFilters;
    phoneQ?: string;
    sipUnregisteredOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
  init?: RequestInit,
): Promise<FetchPhonesListResult> {
  const res = await fetch(buildPhonesListUrl(opts), {
    ...init,
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
          ? "Недостаточно прав для просмотра телефонных номеров"
          : "Не удалось загрузить телефонные номера",
      ),
    };
  }

  return { ok: true, data: body as ListPhonesResult };
}

export async function postPhonesRequest(
  init?: RequestInit,
): Promise<SyncApiResult> {
  const res = await fetch("/api/phones/request", {
    ...init,
    method: "POST",
  });
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

export async function fetchPhonesStatus(
  init?: RequestInit,
): Promise<FetchPhonesStatusResult> {
  const res = await fetch("/api/phones/status", {
    ...init,
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось получить статус запроса"),
    };
  }

  return { ok: true, data: body as PhonesOperationalStatus };
}

export function toSyncStatusSnapshot(
  data: PhonesOperationalStatus,
): PhonesSyncStatusSnapshot {
  return {
    lastJobStatus: data.lastJobStatus,
    lastError: data.lastError,
    lastFinishedAt: data.lastFinishedAt,
    runningCount: data.runningCount,
    lastFailedError: data.lastFailedError,
  };
}

export async function downloadPhonesExport(): Promise<DownloadXlsxResult> {
  return downloadXlsxFromUrl("/api/phones/export", "phones-export.xlsx");
}
