/**
 * Login once, then catalog pages. The password and the token stay out of logs.
 * A 401 on a catalog read refreshes once and repeats that read once.
 */

import { logger } from "@/lib/logger";
import type { RunexisSession } from "@/modules/runexis/parse";
import { parseSession } from "@/modules/runexis/parse";
import {
  catalogUrl,
  codesUrl,
  loginUrl,
  refreshUrl,
  showcaseSliceUrl,
  type CodeSlice,
  type RunexisList,
} from "@/modules/runexis/url";

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

type RunexisDeps = {
  fetchImpl?: typeof fetch;
  beat?: () => Promise<void>;
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

function rejected(
  status: number,
  durationMs: number,
  retryable: boolean,
  note?: string | null,
): Attempt {
  const base =
    status === 401 ? "Площадка отклонила доступ." : "Площадка отклонила запрос.";
  return {
    ok: false,
    error: note ? `${base} ${note}` : base,
    retryable,
    status,
    durationMs,
  };
}

function platformNote(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const flat = message.replace(/\s+/g, " ").trim();
  if (!flat || /:\/\/|bearer|password|token|key=/i.test(flat)) return null;
  return flat.slice(0, 200);
}

/** A read failure stays a single rejection. It must not fall through to the retry. */
async function clientNote(response: Response): Promise<string | null> {
  try {
    const text = await readCapped(response);
    return text ? platformNote(text) : null;
  } catch {
    return null;
  }
}

function unanswered(status: number, durationMs: number, note?: string | null): Attempt {
  return {
    ok: false,
    error: note ? `Площадка не ответила. ${note}` : "Площадка не ответила.",
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
      const text = await readCapped(response);
      return unanswered(response.status, durationMs, text ? platformNote(text) : null);
    }
    if (response.status === 400) {
      return rejected(response.status, durationMs, false, await clientNote(response));
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

function denied(error: string): RunexisPage {
  return {
    ok: false,
    error,
    meta: { status: 0, attempts: 1, durationMs: 0 },
  };
}

async function refreshOnce(
  refreshToken: string,
  deps: RunexisDeps | undefined,
): Promise<RunexisPage> {
  const started = Date.now();
  const attempt = await request(
    refreshUrl(),
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken }),
    },
    deps,
    "refresh",
  );
  return pageFrom(attempt, 1, Date.now() - started);
}

/**
 * One authorized GET. A 5xx is retried once.
 * A 401 refreshes once, then the same GET is sent once. A 403 does not refresh.
 */
async function authorizedGet(
  session: RunexisSession,
  href: string,
  label: string,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  if (!session.token) return denied("Недопустимый запрос.");
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${session.token}`,
  };
  const first = await onceOrTwice(href, { method: "GET", headers }, deps, label);
  if (first.ok || first.meta.status !== 401 || !session.refreshToken) return first;
  await deps?.beat?.();
  const refreshed = await refreshOnce(session.refreshToken, deps);
  if (!refreshed.ok) return refreshed;
  const next = parseSession(refreshed.data);
  if (!next) return denied("Площадка отклонила доступ.");
  session.token = next.token;
  session.refreshToken = next.refreshToken;
  await deps?.beat?.();
  const started = Date.now();
  const attempt = await request(
    href,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${session.token}` },
    },
    deps,
    label,
  );
  return pageFrom(attempt, 1, Date.now() - started);
}

/** Partner pages. Only page and limit are sent. */
export async function runexisRead(
  session: RunexisSession,
  list: RunexisList,
  page: number,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  if (list !== "management") return denied("Недопустимый запрос.");
  const href = catalogUrl("management", page);
  if (!href) return denied("Недопустимый запрос.");
  return authorizedGet(session, href, "management", deps);
}

/** The code directory. No query. */
export async function runexisCodes(
  session: RunexisSession,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  return authorizedGet(session, codesUrl(), "codes", deps);
}

/** One showcase page of one code. */
export async function runexisShowcaseSlice(
  session: RunexisSession,
  page: number,
  slice: CodeSlice,
  deps?: RunexisDeps,
): Promise<RunexisPage> {
  const href = showcaseSliceUrl(page, slice);
  if (!href) return denied("Недопустимый запрос.");
  return authorizedGet(session, href, "showcase", deps);
}
