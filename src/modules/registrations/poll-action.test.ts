import { describe, expect, it, vi } from "vitest";
import {
  IDLE_POLL_STATE,
  interpretPollResponse,
  isPollInFlight,
  reducePollUiState,
  waitForRegsPollOutcome,
} from "@/modules/registrations/poll-action";

describe("manual poll UI state", () => {
  it("transitions idle → pending → success", () => {
    const pending = reducePollUiState(IDLE_POLL_STATE, { type: "START" });
    expect(pending.status).toBe("pending");
    expect(isPollInFlight(pending)).toBe(true);

    const success = reducePollUiState(pending, {
      type: "SUCCESS",
      message: "Опрос завершён успешно",
    });
    expect(success).toEqual({
      status: "success",
      message: "Опрос завершён успешно",
    });
    expect(isPollInFlight(success)).toBe(false);
  });

  it("ignores START while already pending (anti spam-click)", () => {
    const pending = reducePollUiState(IDLE_POLL_STATE, { type: "START" });
    const again = reducePollUiState(pending, { type: "START" });
    expect(again).toBe(pending);
  });

  it("maps conflict and permission failures", () => {
    const conflict = reducePollUiState(IDLE_POLL_STATE, {
      type: "ERROR",
      conflict: true,
      message: "already running",
    });
    expect(conflict.status).toBe("conflict");

    const forbidden = reducePollUiState(IDLE_POLL_STATE, {
      type: "ERROR",
      message: "Forbidden",
    });
    expect(forbidden.status).toBe("error");
  });

  it("interprets POST /api/regs/poll HTTP responses", () => {
    expect(
      interpretPollResponse(200, { accepted: true, message: "regs.poll enqueued" }),
    ).toEqual({ ok: true, message: "regs.poll enqueued" });

    expect(
      interpretPollResponse(409, { accepted: false, reason: "already_running" }),
    ).toEqual({
      ok: false,
      conflict: true,
      message: "Опрос не принят: already_running",
    });

    expect(interpretPollResponse(403, { error: "Forbidden" })).toEqual({
      ok: false,
      conflict: false,
      message: "Forbidden",
    });

    expect(
      interpretPollResponse(429, {
        accepted: false,
        code: "RATE_LIMITED",
        retryAfterSec: 8,
      }),
    ).toEqual({
      ok: false,
      conflict: false,
      message: "Слишком много запросов на опрос — повторите через 8 с",
    });

    expect(
      interpretPollResponse(403, { code: "CSRF_ORIGIN", error: "Forbidden origin" }),
    ).toEqual({
      ok: false,
      conflict: false,
      message:
        "Запрос заблокирован (проверка origin). Обновите страницу и попробуйте снова.",
    });
  });

  it("resets feedback to idle", () => {
    const success = reducePollUiState(IDLE_POLL_STATE, {
      type: "SUCCESS",
      message: "ok",
    });
    expect(reducePollUiState(success, { type: "RESET" })).toEqual(IDLE_POLL_STATE);
  });
});

describe("waitForRegsPollOutcome", () => {
  it("resolves success when lastFinishedAt changes to a success job", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({
        lastJobStatus: "running",
        lastError: null,
        lastFinishedAt: "2026-01-01T00:00:00.000Z",
        runningCount: 1,
      })
      .mockResolvedValueOnce({
        lastJobStatus: "success",
        lastError: null,
        lastFinishedAt: "2026-01-01T00:01:00.000Z",
        runningCount: 0,
      });

    const result = await waitForRegsPollOutcome({
      beforeFinishedAt: "2026-01-01T00:00:00.000Z",
      fetchStatus,
      intervalMs: 1,
      sleepFn: async () => undefined,
    });

    expect(result).toEqual({ ok: true, message: "Опрос завершён успешно" });
  });

  it("resolves failure with lastError when job fails", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      lastJobStatus: "failed",
      lastError: "Permission denied",
      lastFinishedAt: "2026-01-01T00:02:00.000Z",
      runningCount: 0,
    });

    const result = await waitForRegsPollOutcome({
      beforeFinishedAt: "2026-01-01T00:00:00.000Z",
      fetchStatus,
      intervalMs: 1,
      sleepFn: async () => undefined,
    });

    expect(result).toEqual({ ok: false, message: "Permission denied" });
  });

  it("times out if the job never finishes", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      lastJobStatus: "running",
      lastError: null,
      lastFinishedAt: null,
      runningCount: 1,
    });

    const result = await waitForRegsPollOutcome({
      beforeFinishedAt: null,
      fetchStatus,
      timeoutMs: 5,
      intervalMs: 1,
      sleepFn: async () => undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/ожидания/i);
    }
  });
});
