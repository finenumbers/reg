/**
 * Manual phones.sync UI state — mirrors registrations poll helpers.
 */

export type SyncUiState =
  | { status: "idle"; message: null }
  | { status: "pending"; message: null }
  | { status: "success"; message: string }
  | { status: "error"; message: string }
  | { status: "conflict"; message: string };

export type SyncUiEvent =
  | { type: "START" }
  | { type: "SUCCESS"; message?: string }
  | { type: "ERROR"; message: string; conflict?: boolean }
  | { type: "RESET" };

export const IDLE_SYNC_STATE: SyncUiState = { status: "idle", message: null };

export function reduceSyncUiState(
  state: SyncUiState,
  event: SyncUiEvent,
): SyncUiState {
  switch (event.type) {
    case "START":
      if (state.status === "pending") return state;
      return { status: "pending", message: null };
    case "SUCCESS":
      return {
        status: "success",
        message: event.message ?? "Запрос завершён",
      };
    case "ERROR":
      if (event.conflict) {
        return {
          status: "conflict",
          message: event.message || "Запрос уже выполняется",
        };
      }
      return {
        status: "error",
        message: event.message || "Запрос не выполнен",
      };
    case "RESET":
      return IDLE_SYNC_STATE;
    default:
      return state;
  }
}

export function isSyncInFlight(state: SyncUiState): boolean {
  return state.status === "pending";
}

export type SyncApiResult =
  | { ok: true; message: string }
  | { ok: false; conflict: boolean; message: string };

export function interpretSyncResponse(
  status: number,
  body: {
    accepted?: boolean;
    message?: string;
    reason?: string;
    error?: string;
    code?: string;
    retryAfterSec?: number;
  } | null,
): SyncApiResult {
  if (status === 429 || body?.code === "RATE_LIMITED") {
    const wait = body?.retryAfterSec;
    return {
      ok: false,
      conflict: false,
      message: wait
        ? `Слишком много запросов — повторите через ${wait} с`
        : (body?.error ?? "Слишком много запросов — повторите чуть позже"),
    };
  }
  if (status === 403 && body?.code === "CSRF_ORIGIN") {
    return {
      ok: false,
      conflict: false,
      message:
        "Запрос заблокирован (проверка origin). Обновите страницу и попробуйте снова.",
    };
  }
  if (status === 409 || (body?.accepted === false && status !== 429)) {
    return {
      ok: false,
      conflict: true,
      message: body?.reason
        ? `Запрос не принят: ${body.reason}`
        : "Запрос уже выполняется",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      conflict: false,
      message: body?.error ?? "Недостаточно прав для запроса номеров",
    };
  }
  if (status < 200 || status >= 300 || body?.accepted !== true) {
    return {
      ok: false,
      conflict: false,
      message:
        body?.error ?? body?.reason ?? "Не удалось поставить запрос в очередь",
    };
  }
  return {
    ok: true,
    message: body.message ?? "phones.sync поставлен в очередь",
  };
}

export type PhonesSyncStatusSnapshot = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  runningCount: number;
  lastFailedError?: string | null;
};

export type WaitForSyncOutcomeResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const DEFAULT_OUTCOME_TIMEOUT_MS = 150_000;
const DEFAULT_OUTCOME_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForPhonesSyncOutcome(opts: {
  beforeFinishedAt: string | null;
  fetchStatus: () => Promise<PhonesSyncStatusSnapshot>;
  timeoutMs?: number;
  intervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<WaitForSyncOutcomeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OUTCOME_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_OUTCOME_INTERVAL_MS;
  const sleepFn = opts.sleepFn ?? sleep;
  const deadline = Date.now() + timeoutMs;
  let sawRunning = false;

  while (Date.now() < deadline) {
    const status = await opts.fetchStatus();
    const isRunning =
      status.runningCount > 0 || status.lastJobStatus === "running";

    if (isRunning) {
      sawRunning = true;
      await sleepFn(intervalMs);
      continue;
    }

    const finishedAt = status.lastFinishedAt;
    const finishedNewer =
      finishedAt != null && finishedAt !== opts.beforeFinishedAt;

    if (finishedNewer || (sawRunning && status.lastJobStatus !== "running")) {
      if (status.lastJobStatus === "success") {
        return { ok: true, message: "Запрос завершён успешно" };
      }
      if (status.lastJobStatus === "failed") {
        return {
          ok: false,
          message:
            status.lastError ??
            status.lastFailedError ??
            "Запрос завершился с ошибкой",
        };
      }
    }

    await sleepFn(intervalMs);
  }

  return {
    ok: false,
    message: "Истекло время ожидания результата запроса",
  };
}
