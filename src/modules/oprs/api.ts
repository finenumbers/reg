import { encodeFilters, type ColumnFilters } from "@/components/column-filters/types";
import type { OprsListResult } from "@/modules/oprs/service";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

export type OprsListQuery = {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
  success?: boolean;
  timeSort?: TimeSort | null;
  snapshot?: string | null;
  cursor?: { cdrDate: string; cdrId: string } | null;
  pageSize?: number;
};

function writeShared(params: URLSearchParams, opts: OprsListQuery): void {
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.month?.trim()) params.set("month", opts.month.trim());
  if (opts.phantom) params.set("phantom", "1");
  if (opts.callErrors) params.set("callErrors", "1");
  if (opts.parking) params.set("parking", "1");
  if (opts.failed) params.set("failed", "1");
  if (opts.check) params.set("check", "1");
  if (opts.success) params.set("success", "1");
  if (opts.timeSort) params.set("timeSort", opts.timeSort);
  if (opts.snapshot?.trim()) params.set("snapshot", opts.snapshot.trim());
  if (opts.cursor?.cdrDate && opts.cursor.cdrId) {
    params.set("cursorDate", opts.cursor.cdrDate);
    params.set("cursorId", opts.cursor.cdrId);
  }
}

export function buildOprsListUrl(opts: OprsListQuery = {}): string {
  const params = new URLSearchParams();
  writeShared(params, opts);
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return qs ? `/api/oprs?${qs}` : "/api/oprs";
}

export function buildOprsFacetsUrl(
  opts: OprsListQuery & { column: string; q?: string; limit?: number },
): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  writeShared(params, opts);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/oprs/facets?${params.toString()}`;
}

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

export async function fetchOprsList(
  opts: OprsListQuery,
): Promise<{ ok: true; data: OprsListResult } | { ok: false; message: string }> {
  const res = await fetch(buildOprsListUrl(opts), { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, message: errorMessage(body, "Не удалось загрузить звонки в ОПРС") };
  }
  return { ok: true, data: body as OprsListResult };
}
