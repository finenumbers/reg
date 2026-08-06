/**
 * Manual poll UI state machine — keeps button disable / feedback logic testable.
 */

export type PollUiState =
  | { status: "idle"; message: null }
  | { status: "pending"; message: null }
  | { status: "success"; message: string }
  | { status: "error"; message: string }
  | { status: "conflict"; message: string };

export type PollUiEvent =
  | { type: "START" }
  | { type: "SUCCESS"; message?: string }
  | { type: "ERROR"; message: string; conflict?: boolean }
  | { type: "RESET" };

export const IDLE_POLL_STATE: PollUiState = { status: "idle", message: null };

export function reducePollUiState(
  state: PollUiState,
  event: PollUiEvent,
): PollUiState {
  switch (event.type) {
    case "START":
      if (state.status === "pending") return state;
      return { status: "pending", message: null };
    case "SUCCESS":
      return {
        status: "success",
        message: event.message ?? "Опрос завершён",
      };
    case "ERROR":
      if (event.conflict) {
        return {
          status: "conflict",
          message: event.message || "Опрос уже выполняется",
        };
      }
      return { status: "error", message: event.message || "Опрос не выполнен" };
    case "RESET":
      return IDLE_POLL_STATE;
    default:
      return state;
  }
}

export function isPollInFlight(state: PollUiState): boolean {
  return state.status === "pending";
}

export type PollApiResult =
  | { ok: true; message: string }
  | { ok: false; conflict: boolean; message: string };

/** Map POST /api/regs/poll response into a UI-friendly result. */
export function interpretPollResponse(
  status: number,
  body: {
    accepted?: boolean;
    message?: string;
    reason?: string;
    error?: string;
    code?: string;
    retryAfterSec?: number;
  } | null,
): PollApiResult {
  if (status === 429 || body?.code === "RATE_LIMITED") {
    const wait = body?.retryAfterSec;
    return {
      ok: false,
      conflict: false,
      message: wait
        ? `Слишком много запросов на опрос — повторите через ${wait} с`
        : (body?.error ?? "Слишком много запросов на опрос — повторите чуть позже"),
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
        ? `Опрос не принят: ${body.reason}`
        : "Опрос уже выполняется",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      conflict: false,
      message: body?.error ?? "Недостаточно прав для запуска опроса",
    };
  }
  if (status < 200 || status >= 300 || body?.accepted !== true) {
    return {
      ok: false,
      conflict: false,
      message: body?.error ?? body?.reason ?? "Не удалось поставить опрос в очередь",
    };
  }
  return {
    ok: true,
    message: body.message ?? "regs.poll поставлен в очередь",
  };
}

/** Snapshot fields from GET /api/regs/status used while waiting for job outcome. */
export type RegsPollStatusSnapshot = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  runningCount: number;
  lastFailedError?: string | null;
};

export type WaitForPollOutcomeResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const DEFAULT_OUTCOME_TIMEOUT_MS = 90_000;
const DEFAULT_OUTCOME_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * After enqueue, wait until the regs.poll job finishes (success or failed).
 * Uses lastFinishedAt change + runningCount so a previous success is not mistaken
 * for the new job completing.
 */
export async function waitForRegsPollOutcome(opts: {
  beforeFinishedAt: string | null;
  fetchStatus: () => Promise<RegsPollStatusSnapshot>;
  timeoutMs?: number;
  intervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<WaitForPollOutcomeResult> {
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
        return { ok: true, message: "Опрос завершён успешно" };
      }
      if (status.lastJobStatus === "failed") {
        return {
          ok: false,
          message:
            status.lastError ??
            status.lastFailedError ??
            "Опрос завершился с ошибкой",
        };
      }
    }

    await sleepFn(intervalMs);
  }

  return {
    ok: false,
    message: "Истекло время ожидания результата опроса",
  };
}
