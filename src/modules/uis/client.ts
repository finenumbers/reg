/**
 * One JSON-RPC POST. The token stays in the body and out of logs and errors.
 * Transport failures retry once. A minute quota waits once, then repeats once.
 */

import { randomInt } from "node:crypto";

import { logger } from "@/lib/logger";
import { parseRpc, scrubUisText, type RpcOk } from "@/modules/uis/parse";
import { UIS_ORIGIN, buildRequest, type UisCall, type UisList } from "@/modules/uis/url";

const TIMEOUT_MS = 30_000;
const BODY_CAP = 20 * 1024 * 1024;

type UisMeta = {
  status: number;
  attempts: number;
  durationMs: number;
};

export type UisPage =
  | { ok: true; total: number; rows: RpcOk["rows"]; meta: UisMeta }
  | { ok: false; error: string; meta: UisMeta };

type Attempt =
  | { ok: true; data: unknown; status: number; durationMs: number }
  | { ok: false; error: string; retryable: boolean; status: number; durationMs: number };

type UisDeps = {
  fetchImpl?: typeof fetch;
  beat?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function request(
  body: string,
  deps: UisDeps | undefined,
  label: string,
): Promise<Attempt> {
  const started = Date.now();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(UIS_ORIGIN, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=UTF-8",
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    logger.info("uis.request", { action: label, status: 0 });
    return {
      ok: false,
      error: "Площадка не ответила.",
      retryable: true,
      status: 0,
      durationMs: Date.now() - started,
    };
  }
  logger.info("uis.request", { action: label, status: response.status });
  try {
    const durationMs = Date.now() - started;
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
      await response.body?.cancel().catch(() => undefined);
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
        retryable: true,
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
): UisPage {
  return {
    ok: false,
    error: `${error} HTTP ${status}, попыток ${attempts}, ${durationMs} мс.`,
    meta: { status, attempts, durationMs },
  };
}

async function postOnce(
  body: string,
  deps: UisDeps | undefined,
  label: string,
): Promise<{ attempt: Attempt; attempts: number; durationMs: number }> {
  const started = Date.now();
  const first = await request(body, deps, label);
  if (first.ok || !first.retryable) {
    return { attempt: first, attempts: 1, durationMs: Date.now() - started };
  }
  const second = await request(body, deps, label);
  return { attempt: second, attempts: 2, durationMs: Date.now() - started };
}

function modeOf(call: UisCall): "count" | "read" {
  return call.purpose === "count" || call.purpose === "probe" ? "count" : "read";
}

function limitOf(call: UisCall): number {
  if (call.purpose === "access") return 1000;
  if (call.purpose === "read") return 10_000;
  return 1;
}

async function waitQuota(seconds: number, deps: UisDeps | undefined): Promise<void> {
  await deps?.beat?.();
  if (seconds <= 0) return;
  await (deps?.sleep ?? sleep)(seconds * 1000);
}

/** One catalog read. The method and the filter are fixed by the call. */
export async function uisCall(
  token: string,
  list: UisList,
  call: UisCall,
  deps?: UisDeps,
): Promise<UisPage> {
  const id = randomInt(1, 2_147_483_647);
  const body = buildRequest(token, list, call, id);
  if (!body) {
    return failed("Недопустимый запрос.", 0, 1, 0);
  }
  const label = list;
  let quotaRetry = false;
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    const posted = await postOnce(body, deps, label);
    attempts += posted.attempts;
    if (!posted.attempt.ok) {
      const error =
        scrubUisText(token, posted.attempt.error) ?? "Площадка отклонила запрос.";
      return failed(error, posted.attempt.status, attempts, Date.now() - started);
    }
    const parsed = parseRpc(
      posted.attempt.data,
      id,
      token,
      list,
      modeOf(call),
      limitOf(call),
    );
    if (!parsed.ok) {
      if (parsed.minuteWait != null && !quotaRetry) {
        quotaRetry = true;
        await waitQuota(parsed.minuteWait, deps);
        continue;
      }
      const error = scrubUisText(token, parsed.error) ?? "Площадка отклонила запрос.";
      return failed(error, posted.attempt.status, attempts, Date.now() - started);
    }
    if (
      parsed.minuteRemaining === 0 &&
      (parsed.minuteReset == null || parsed.minuteReset > 90)
    ) {
      return failed(
        "Минутная квота исчерпана.",
        posted.attempt.status,
        attempts,
        Date.now() - started,
      );
    }
    if (parsed.minuteRemaining === 0 && parsed.minuteReset != null) {
      await waitQuota(parsed.minuteReset, deps);
    }
    return {
      ok: true,
      total: parsed.total,
      rows: parsed.rows,
      meta: {
        status: posted.attempt.status,
        attempts,
        durationMs: Date.now() - started,
      },
    };
  }
}
