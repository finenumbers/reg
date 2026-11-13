/**
 * Three GET reads. The key stays in the query and out of errors and logs.
 */

import { logger } from "@/lib/logger";
import { type SipoutRead, sipoutUrl } from "@/modules/sipout/url";

const TIMEOUT_MS = 30_000;
const BODY_CAP = 20 * 1024 * 1024;

export type SipoutMeta = {
  status: number;
  attempts: number;
  durationMs: number;
};

export type SipoutPage =
  | { ok: true; data: unknown; meta: SipoutMeta }
  | { ok: false; error: string; meta: SipoutMeta };

type Attempt =
  | { ok: true; data: unknown; status: number; durationMs: number }
  | { ok: false; error: string; retryable: boolean; status: number; durationMs: number };

export type SipoutDeps = {
  fetchImpl?: typeof fetch;
};

function publicError(errText: unknown, key: string): string {
  const fallback = "Площадка отклонила запрос.";
  if (typeof errText !== "string") return fallback;
  const text = errText.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text || text.includes(key) || /key=/i.test(text) || text.includes("://"))
    return fallback;
  return text;
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_CAP) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) {
    const text = await response.text();
    return text.length > BODY_CAP ? null : text;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > BODY_CAP) {
      await reader.cancel();
      return null;
    }
    parts.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function once(
  key: string,
  read: SipoutRead,
  deps: SipoutDeps | undefined,
): Promise<Attempt> {
  const started = Date.now();
  const href = sipoutUrl(key, read);
  if (!href) {
    return {
      ok: false,
      error: "Недопустимый запрос.",
      retryable: false,
      status: 0,
      durationMs: 0,
    };
  }
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(href, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch {
    logger.info("sipout.request", { action: read.action, status: 0 });
    return {
      ok: false,
      error: "Площадка не ответила.",
      retryable: true,
      status: 0,
      durationMs: Date.now() - started,
    };
  }
  logger.info("sipout.request", { action: read.action, status: response.status });
  const durationMs = Date.now() - started;
  if (response.status >= 500) {
    await response.body?.cancel();
    return {
      ok: false,
      error: "Площадка не ответила.",
      retryable: true,
      status: response.status,
      durationMs,
    };
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return {
      ok: false,
      error: "Площадка отклонила запрос.",
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  const text = await readCapped(response);
  if (text == null) {
    return {
      ok: false,
      error: "Ответ площадки слишком большой.",
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  if (!text) {
    return {
      ok: false,
      error: "Ответ площадки обрезан.",
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error: "Ответ площадки обрезан.",
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: "Ответ площадки обрезан.",
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  const result = (body as { result?: unknown }).result;
  if (result === "ok") {
    return { ok: true, data: (body as { data?: unknown }).data, status: response.status, durationMs };
  }
  if (result === "bad") {
    return {
      ok: false,
      error: publicError((body as { err_text?: unknown }).err_text, key),
      retryable: false,
      status: response.status,
      durationMs,
    };
  }
  return {
    ok: false,
    error: "Ответ площадки обрезан.",
    retryable: false,
    status: response.status,
    durationMs,
  };
}

function pageFrom(attempt: Attempt, attempts: number, durationMs: number): SipoutPage {
  const meta = { status: attempt.status, attempts, durationMs };
  if (attempt.ok) return { ok: true, data: attempt.data, meta };
  return { ok: false, error: attempt.error, meta };
}

/** One retry after a transport failure, a timeout, or a 5xx. */
export async function sipoutGet(
  key: string,
  read: SipoutRead,
  deps?: SipoutDeps,
): Promise<SipoutPage> {
  const started = Date.now();
  const first = await once(key, read, deps);
  if (first.ok || !first.retryable) return pageFrom(first, 1, Date.now() - started);
  const second = await once(key, read, deps);
  return pageFrom(second, 2, Date.now() - started);
}
