/**
 * Three JSON POSTs. The key stays in the Authorization header and out of logs.
 * Transport, timeout, an empty body, non-JSON, and HTTP 5xx retry once.
 * HTTP 4xx and a body over 20 MB do not.
 */

import { logger } from "@/lib/logger";
import {
  parseDirectory,
  parseFree,
  parsePurchased,
  parsePurchasedTotal,
  scrubExolveText,
  type Directory,
  type ExolveFreeRow,
} from "@/modules/exolve/parse";
import {
  PURCHASED_LIMIT,
  directoryUrl,
  freeBody,
  freeUrl,
  purchasedBody,
  purchasedUrl,
  type FreeCell,
  type FreeRandomMode,
  type PurchasedFilter,
} from "@/modules/exolve/url";

const TIMEOUT_MS = 30_000;
const BODY_CAP = 20 * 1024 * 1024;
const ERROR_CAP = 8192;

export type ExolveMeta = {
  status: number;
  attempts: number;
  durationMs: number;
};

export type ExolveDeps = {
  fetchImpl?: typeof fetch;
  beat?: () => Promise<void>;
  note?: (line: string) => Promise<void> | void;
};

type Attempt =
  | { ok: true; data: unknown; status: number; durationMs: number }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      status: number;
      durationMs: number;
    };

type CallResult<T> =
  ({ ok: true; meta: ExolveMeta } & T) | { ok: false; error: string; meta: ExolveMeta };

function keyOk(key: string): boolean {
  return key.length > 0 && key.length <= 4096 && !/[\r\n]/.test(key);
}

async function readCapped(response: Response, cap: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) {
    const text = await response.text();
    return text.length > cap ? null : text;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
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

function platformError(key: string, text: string | null): string {
  if (!text) return "Площадка отклонила запрос.";
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const error = (data as { error?: unknown }).error;
      if (typeof error === "string") {
        return scrubExolveText(key, error) ?? "Площадка отклонила запрос.";
      }
    }
  } catch {
    /* A non-JSON error page stays off the operator message. */
  }
  return "Площадка отклонила запрос.";
}

async function request(
  key: string,
  url: string,
  body: string,
  deps: ExolveDeps | undefined,
  action: string,
): Promise<Attempt> {
  const started = Date.now();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  await deps?.beat?.();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    logger.info("exolve.request", { action, status: 0 });
    return {
      ok: false,
      error: "Площадка не ответила.",
      retryable: true,
      status: 0,
      durationMs: Date.now() - started,
    };
  }
  logger.info("exolve.request", { action, status: response.status });
  const durationMs = Date.now() - started;
  try {
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        error: "Площадка не ответила.",
        retryable: true,
        status: response.status,
        durationMs,
      };
    }
    if (response.status !== 200) {
      const text = await readCapped(response, ERROR_CAP);
      return {
        ok: false,
        error: platformError(key, text),
        retryable: false,
        status: response.status,
        durationMs,
      };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > BODY_CAP) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        error: "Ответ площадки слишком большой.",
        retryable: false,
        status: response.status,
        durationMs,
      };
    }
    const text = await readCapped(response, BODY_CAP);
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
        retryable: true,
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
        retryable: true,
        status: response.status,
        durationMs,
      };
    }
  } catch {
    return {
      ok: false,
      error: "Площадка не ответила.",
      retryable: true,
      status: response.status,
      durationMs: Date.now() - started,
    };
  }
}

function failed(
  error: string,
  status: number,
  attempts: number,
  durationMs: number,
): {
  ok: false;
  error: string;
  meta: ExolveMeta;
} {
  const suffix = `HTTP ${status}, попыток ${attempts}, ${durationMs} мс.`;
  const text = `${error} ${suffix}`.slice(0, 200);
  return { ok: false, error: text, meta: { status, attempts, durationMs } };
}

async function postOnce(
  key: string,
  url: string,
  body: string,
  deps: ExolveDeps | undefined,
  action: string,
): Promise<{ attempt: Attempt; attempts: number; durationMs: number }> {
  const started = Date.now();
  const first = await request(key, url, body, deps, action);
  if (first.ok || !first.retryable) {
    return { attempt: first, attempts: 1, durationMs: Date.now() - started };
  }
  const second = await request(key, url, body, deps, action);
  return { attempt: second, attempts: 2, durationMs: Date.now() - started };
}

async function finish<T>(
  key: string,
  deps: ExolveDeps | undefined,
  action: string,
  detail: string,
  posted: { attempt: Attempt; attempts: number; durationMs: number },
  parse: (data: unknown) => ({ ok: true } & T) | { ok: false; error: string },
): Promise<CallResult<T>> {
  const { attempt, attempts, durationMs } = posted;
  await deps?.note?.(
    `${action} ${detail} status=${attempt.status} attempts=${attempts} durationMs=${durationMs}`,
  );
  if (!attempt.ok) {
    const error = scrubExolveText(key, attempt.error) ?? "Площадка отклонила запрос.";
    return failed(error, attempt.status, attempts, durationMs);
  }
  const parsed = parse(attempt.data);
  if (!parsed.ok) {
    const error = scrubExolveText(key, parsed.error) ?? "Площадка отклонила запрос.";
    return failed(error, attempt.status, attempts, durationMs);
  }
  const { ok: _ok, ...rest } = parsed;
  void _ok;
  return {
    ok: true,
    ...(rest as T),
    meta: { status: attempt.status, attempts, durationMs },
  };
}

export function createExolveClient(key: string, deps?: ExolveDeps) {
  async function send<T>(
    action: string,
    detail: string,
    url: string,
    body: string | null,
    parse: (data: unknown) => ({ ok: true } & T) | { ok: false; error: string },
  ): Promise<CallResult<T>> {
    if (!keyOk(key) || body == null) {
      return failed("Недопустимый запрос.", 0, 1, 0);
    }
    const posted = await postOnce(key, url, body, deps, action);
    return finish(key, deps, action, detail, posted, parse);
  }

  return {
    purchased(filter: PurchasedFilter, offset: number) {
      const body = purchasedBody(filter, offset);
      return send(
        "purchased",
        `offset=${offset}`,
        purchasedUrl(),
        body && JSON.stringify(body),
        (data) => parsePurchased(data, PURCHASED_LIMIT),
      );
    },
    recount() {
      const body = purchasedBody({ kind: "all" }, 0);
      return send(
        "recount",
        "offset=0",
        purchasedUrl(),
        body && JSON.stringify(body),
        parsePurchasedTotal,
      );
    },
    directory() {
      return send("directory", "offset=0", directoryUrl(), "{}", (data) => {
        const parsed = parseDirectory(data);
        if (!parsed.ok) return parsed;
        return { ok: true as const, directory: parsed.directory };
      });
    },
    free(cell: FreeCell, offset: number, randomMode: FreeRandomMode = "false") {
      const body = freeBody(cell, offset, randomMode);
      return send(
        "free",
        `type=${cell.typeId} region=${cell.regionId} category=${cell.categoryId} offset=${offset}`,
        freeUrl(),
        body && JSON.stringify(body),
        parseFree,
      );
    },
  };
}

export type ExolveClient = ReturnType<typeof createExolveClient>;
export type { Directory, ExolveFreeRow };
