/**
 * Server-side GET reader for the current PSTN numbering dataset.
 * Three paths only. No API key. No dataset parameter.
 */

import { logger } from "@/lib/logger";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import { PSTN_UNREACHABLE_HINT, normalizePstnBaseUrl } from "@/modules/pstn/types";

export const NUMBERING_PSTN_TIMEOUT_MS = 30_000;

const PATHS = ["/api/ranges", "/api/ranges/facets", "/api/summary"] as const;

export type NumberingPstnPath = (typeof PATHS)[number];

export type PstnReadOptions = {
  signal?: AbortSignal;
  clientIp?: string | null;
  timeoutMs?: number;
};

function singleClientIp(ip: string | null | undefined): string | null {
  const value = ip?.trim() ?? "";
  if (!value || value.length > 64) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  return value;
}

function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 300);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim())
      return message.trim().slice(0, 300);
  }
  return null;
}

function unreachable(): NumberingClientError {
  return new NumberingClientError("NETWORK", PSTN_UNREACHABLE_HINT);
}

export async function readPstnJson(
  path: NumberingPstnPath,
  params: URLSearchParams,
  baseUrl: string,
  options: PstnReadOptions = {},
): Promise<unknown> {
  let origin: string;
  try {
    origin = normalizePstnBaseUrl(baseUrl);
  } catch {
    throw unreachable();
  }

  const timeout = new AbortController();
  const timeoutMs = options.timeoutMs ?? NUMBERING_PSTN_TIMEOUT_MS;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;

  const url = new URL(path, origin);
  params.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const headers: Record<string, string> = { Accept: "application/json" };
  const clientIp = singleClientIp(options.clientIp);
  if (clientIp) {
    headers["X-Forwarded-For"] = clientIp;
    headers["X-Real-IP"] = clientIp;
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal,
      cache: "no-store",
    });
    const durationMs = Date.now() - started;
    const text = await res.text();
    logger.info("pstn.numbering", {
      host: url.host,
      path,
      status: res.status,
      durationMs,
    });

    const trimmed = text.trim();
    const looksHtml =
      trimmed.startsWith("<") ||
      (res.headers.get("content-type") ?? "").includes("text/html");
    if (looksHtml || res.status === 401 || res.status === 403) {
      throw unreachable();
    }

    let body: unknown = null;
    if (trimmed) {
      try {
        body = JSON.parse(trimmed) as unknown;
      } catch {
        throw unreachable();
      }
    }

    if (res.status === 429) {
      throw new NumberingClientError(
        "RATE_LIMITED",
        messageFromBody(body) ?? "Слишком много запросов. Повторите позже.",
        429,
      );
    }
    if (res.status === 400) {
      throw new NumberingClientError(
        "HTTP_ERROR",
        messageFromBody(body) ?? "Некорректный запрос",
        400,
      );
    }
    if (!res.ok || body == null) {
      throw new NumberingClientError(
        "HTTP_ERROR",
        "Не удалось прочитать ресурс нумерации.",
        res.status,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof NumberingClientError) throw error;
    if (timeout.signal.aborted) {
      throw new NumberingClientError("TIMEOUT", PSTN_UNREACHABLE_HINT);
    }
    if (options.signal?.aborted) {
      throw new NumberingClientError("ABORTED", "Запрос отменён");
    }
    throw unreachable();
  } finally {
    clearTimeout(timer);
  }
}
