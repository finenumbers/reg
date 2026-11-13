/**
 * Server-side reader for the DID purchased catalog.
 * GET /numbers/purchased. Nothing else.
 */

import { logger } from "@/lib/logger";
import {
  DID_TIMEOUT_MESSAGE,
  DID_UNAUTHORIZED_MESSAGE,
  DID_UNAVAILABLE_MESSAGE,
  DID_UNREACHABLE_HINT,
  didApiUrl,
  type DidApiPath,
  type DidCredentials,
} from "@/modules/did/types";

export type DidClientErrorCode =
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "NOT_CONFIGURED"
  | "BAD_RESPONSE"
  | "ABORTED";

export class DidClientError extends Error {
  /**
   * Set only when DID rejected `page_size`. `null` means the 422 named that
   * parameter and did not include a usable maximum.
   */
  readonly pageSizeLimit: number | null | undefined;

  constructor(
    public readonly code: DidClientErrorCode,
    message: string,
    public readonly httpStatus?: number,
    pageSizeLimit?: number | null,
  ) {
    super(message);
    this.name = "DidClientError";
    this.pageSizeLimit = pageSizeLimit;
  }
}

export type DidFreePage = {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
};

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid";
  }
}

function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    return record.detail.trim();
  }
  return null;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function didGet(
  path: DidApiPath,
  params: URLSearchParams,
  creds: DidCredentials,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const started = Date.now();
  const url = didApiUrl(creds.baseUrl, path, params);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${creds.apiToken}`,
      },
      signal: combined,
      cache: "no-store",
    });
    const durationMs = Date.now() - started;
    const body = await readBody(res);
    logger.info("did.request", {
      host: hostOf(creds.baseUrl),
      path,
      status: res.status,
      durationMs,
    });
    if (res.status === 401) {
      throw new DidClientError("UNAUTHORIZED", DID_UNAUTHORIZED_MESSAGE, 401);
    }
    if (res.status === 400) {
      throw new DidClientError(
        "HTTP_ERROR",
        messageFromBody(body) ?? "Некорректный фильтр",
        400,
      );
    }
    if (res.status === 422) {
      const rejection = readPageSizeRejection(body);
      if (rejection) {
        throw new DidClientError(
          "HTTP_ERROR",
          rejection.limit != null
            ? `DID принимает не больше ${rejection.limit} строк на страницу`
            : "DID не принял размер страницы",
          422,
          rejection.limit,
        );
      }
    }
    if (!res.ok) {
      throw new DidClientError("HTTP_ERROR", DID_UNAVAILABLE_MESSAGE, res.status);
    }
    if (body == null) {
      throw new DidClientError("BAD_RESPONSE", DID_UNAVAILABLE_MESSAGE, res.status);
    }
    return body;
  } catch (error) {
    if (error instanceof DidClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) throw new DidClientError("ABORTED", "Запрос отменён");
      throw new DidClientError("TIMEOUT", DID_TIMEOUT_MESSAGE);
    }
    throw new DidClientError("NETWORK", DID_UNREACHABLE_HINT);
  } finally {
    clearTimeout(timer);
  }
}

/** FastAPI query validation. Other 422 bodies stay a normal HTTP error. */
export function readPageSizeRejection(body: unknown): { limit: number | null } | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return null;
  for (const item of detail) {
    if (!item || typeof item !== "object") continue;
    const loc = (item as { loc?: unknown }).loc;
    if (!Array.isArray(loc) || !loc.includes("page_size")) continue;
    const ctx = (item as { ctx?: unknown }).ctx;
    const raw = ctx && typeof ctx === "object" ? (ctx as { le?: unknown }).le : undefined;
    const le =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(le) && le >= 1) return { limit: Math.floor(le) };
    return { limit: null };
  }
  return null;
}

function parsePage(body: unknown): DidFreePage {
  if (!body || typeof body !== "object") {
    throw new DidClientError("BAD_RESPONSE", DID_UNAVAILABLE_MESSAGE);
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.items) || typeof record.total !== "number") {
    throw new DidClientError("BAD_RESPONSE", DID_UNAVAILABLE_MESSAGE);
  }
  return {
    items: record.items,
    total: record.total,
    page: typeof record.page === "number" ? record.page : 1,
    pageSize:
      typeof record.page_size === "number" ? record.page_size : record.items.length,
  };
}

function assertCatalogKind(items: unknown[]): void {
  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      throw new DidClientError("BAD_RESPONSE", DID_UNAVAILABLE_MESSAGE);
    }
    if ((raw as Record<string, unknown>).inventory_kind !== "purchased") {
      throw new DidClientError("BAD_RESPONSE", DID_UNAVAILABLE_MESSAGE);
    }
  }
}

/** Unfiltered purchased catalog. Callers cannot pass a filter or a phone search. */
export async function listDidPurchasedNumbers(
  page: number,
  pageSize: number,
  creds: DidCredentials,
  timeoutMs: number,
): Promise<DidFreePage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    sort_by: "abc_code",
    sort_dir: "asc",
  });
  const result = parsePage(await didGet("/numbers/purchased", params, creds, timeoutMs));
  assertCatalogKind(result.items);
  return result;
}
