/**
 * Login once, then showcase pages. The password and the token stay out of logs.
 */

import { logger } from "@/lib/logger";
import { loginUrl, showcaseUrl } from "@/modules/runexis/url";

const TIMEOUT_MS = 30_000;
const BODY_CAP = 20 * 1024 * 1024;

export type RunexisMeta = {
  status: number;
  attempts: number;
  durationMs: number;
};

export type RunexisPage =
  | { ok: true; data: unknown; meta: RunexisMeta }
  | { ok: false; error: string; meta: RunexisMeta };

type Attempt =
  | { ok: true; data: unknown; status: number; durationMs: number }
  | { ok: false; error: string; retryable: boolean; status: number; durationMs: number };

export type RunexisDeps = {
  fetchImpl?: typeof fetch;
};

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

function rejected(status: number, durationMs: number, retryable: boolean): Attempt {
  return {
    ok: false,
    error: status === 401 ? "Площадка отклонила доступ." : "Площадка отклонила запрос.",
    retryable,
    status,
    durationMs,
  };
}

function unanswered(status: number, durationMs: number): Attempt {
  return {
    ok: false,
    error: "Площадка не ответила.",
    retryable: true,
    status,
    durationMs,
  };
}

async function request(
  href: string,
  init: RequestInit,
  deps: RunexisDeps | undefined,
  label: string,
): Promise<Attempt> {
  const started = Date.now();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(href, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    logger.info("runexis.request", { action: label, status: 0 });
    return unanswered(0, Date.now() - started);
  }
  logger.info("runexis.request", { action: label, status: response.status });
  try {
    const durationMs = Date.now() - started;
    if (response.status >= 500) {
      await response.body?.cancel();
      return unanswered(response.status, durationMs);
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return rejected(response.status, durationMs, false);
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
    try {
      return {
        ok: true,
        data: JSON.parse(text) as unknown,
        status: response.status,
        durationMs,
      };
    } catch {
      return {
        ok: false,
        error: "Ответ площадки обрезан.",
        retryable: false,
        status: response.status,
        durationMs,
      };
    }
  } catch {
    return unanswered(response.status, Date.now() - started);
  }
}

function pageFrom(attempt: Attempt, attempts: number, durationMs: number): RunexisPage {
  const meta = { status: attempt.status, attempts, durationMs };
  if (attempt.ok) return { ok: true, data: attempt.data, meta };
  return {
    ok: false,
    error: `${attempt.error} HTTP ${attempt.status}, попыток ${attempts}, ${durationMs} мс.`,
    meta,
  };
}

async function onceOrTwice(
  href: string,
  init: RequestInit,
  deps: RunexisDeps | undefined,
  label: string,
): Promise<RunexisPage> {
  const started = Date.now();
  const first = await request(href, init, deps, label);
  if (first.ok || !first.retryable) return pageFrom(first, 1, Date.now() - started);
  const second = await request(href, init, deps, label);
  return pageFrom(second, 2, Date.now() - started);
}

/** One login. The body is not logged. A transport failure is retried once. */
export async function runexisLogin(
  email: string,
  password: string,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  return onceOrTwice(
    loginUrl(),
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    deps,
    "login",
  );
}

/** One showcase page. Only page and limit are sent. A 4xx is not retried. */
export async function runexisShowcase(
  token: string,
  page: number,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  const href = showcaseUrl(page);
  if (!href || !token) {
    return {
      ok: false,
      error: "Недопустимый запрос.",
      meta: { status: 0, attempts: 1, durationMs: 0 },
    };
  }
  return onceOrTwice(
    href,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    },
    deps,
    "showcase",
  );
}
