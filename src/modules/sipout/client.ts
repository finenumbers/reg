/**
 * Three GET reads. The key stays in the query and out of errors and logs.
 */

import { logger } from "@/lib/logger";
import { type SipoutRead, sipoutUrl } from "@/modules/sipout/url";

const TIMEOUT_MS = 30_000;
const BODY_CAP = 20 * 1024 * 1024;

export type SipoutPage = { ok: true; data: unknown } | { ok: false; error: string };

type Attempt =
  { ok: true; data: unknown } | { ok: false; error: string; retryable: boolean };

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
  const href = sipoutUrl(key, read);
  if (!href) return { ok: false, error: "Недопустимый запрос.", retryable: false };
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
    return { ok: false, error: "Площадка не ответила.", retryable: true };
  }
  logger.info("sipout.request", { action: read.action, status: response.status });
  if (response.status >= 500) {
    await response.body?.cancel();
    return { ok: false, error: "Площадка не ответила.", retryable: true };
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return { ok: false, error: "Площадка отклонила запрос.", retryable: false };
  }
  const text = await readCapped(response);
  if (text == null)
    return { ok: false, error: "Ответ площадки слишком большой.", retryable: false };
  if (!text) return { ok: false, error: "Ответ площадки обрезан.", retryable: false };
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "Ответ площадки обрезан.", retryable: false };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Ответ площадки обрезан.", retryable: false };
  }
  const result = (body as { result?: unknown }).result;
  if (result === "ok") return { ok: true, data: (body as { data?: unknown }).data };
  if (result === "bad") {
    return {
      ok: false,
      error: publicError((body as { err_text?: unknown }).err_text, key),
      retryable: false,
    };
  }
  return { ok: false, error: "Ответ площадки обрезан.", retryable: false };
}

/** One retry after a transport failure, a timeout, or a 5xx. */
export async function sipoutGet(
  key: string,
  read: SipoutRead,
  deps?: SipoutDeps,
): Promise<SipoutPage> {
  const first = await once(key, read, deps);
  if (first.ok || !first.retryable)
    return first.ok ? first : { ok: false, error: first.error };
  const second = await once(key, read, deps);
  return second.ok ? second : { ok: false, error: second.error };
}
