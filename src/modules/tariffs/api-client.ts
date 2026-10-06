/**
 * Browser fetch helpers for the tariff snapshot.
 */

import type { ListTariffsResult } from "@/modules/tariffs/service";

export type FetchTariffsResult =
  { ok: true; data: ListTariffsResult } | { ok: false; status: number; message: string };

export type ImportTariffsResult =
  | { ok: true; rowCount: number; loadedAt: string }
  | { ok: false; status: number; error: string; details: string[] };

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

export async function fetchTariffsList(opts: {
  page?: number;
  pageSize?: number;
}): Promise<FetchTariffsResult> {
  const params = new URLSearchParams();
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  const res = await fetch(`/api/tariffs?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось загрузить тарификацию"),
    };
  }
  return { ok: true, data: body as ListTariffsResult };
}

export async function importTariffsFile(file: File): Promise<ImportTariffsResult> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/tariffs/import", {
    method: "POST",
    body,
    cache: "no-store",
  });
  const json = await readJson(res);
  if (!res.ok) {
    let error = "Не удалось загрузить данные";
    let details: string[] = [];
    if (json && typeof json === "object") {
      const record = json as { error?: unknown; details?: unknown };
      if (typeof record.error === "string" && record.error.trim()) {
        error = record.error.trim();
      }
      if (Array.isArray(record.details)) {
        details = record.details
          .filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
          )
          .map((item) => item.trim());
      }
    }
    if (details.length === 0) details = [error];
    return { ok: false, status: res.status, error, details };
  }
  const record = json as { rowCount?: unknown; loadedAt?: unknown };
  return {
    ok: true,
    rowCount: typeof record.rowCount === "number" ? record.rowCount : 0,
    loadedAt: typeof record.loadedAt === "string" ? record.loadedAt : "",
  };
}
