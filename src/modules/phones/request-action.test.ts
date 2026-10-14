import { describe, expect, it, vi } from "vitest";
import {
  interpretSyncResponse,
  waitForPhonesSyncOutcome,
} from "@/modules/phones/request-action";

describe("interpretSyncResponse", () => {
  it("uses reason on 409 (phones / traffic / aligned groups)", () => {
    expect(
      interpretSyncResponse(409, {
        accepted: false,
        reason: "already_running",
      }),
    ).toEqual({
      ok: false,
      conflict: true,
      message: "Запрос не принят: already_running",
    });
  });

  it("falls back to error on 409 when reason is absent (legacy groups)", () => {
    expect(
      interpretSyncResponse(409, {
        accepted: false,
        error: "Sync already in progress",
        code: "ALREADY_RUNNING",
      }),
    ).toEqual({
      ok: false,
      conflict: true,
      message: "Запрос не принят: Sync already in progress",
    });
  });

  it("prefers reason over error when both are present", () => {
    expect(
      interpretSyncResponse(409, {
        accepted: false,
        reason: "rejected",
        error: "Sync already in progress",
        code: "ALREADY_RUNNING",
      }),
    ).toEqual({
      ok: false,
      conflict: true,
      message: "Запрос не принят: rejected",
    });
  });

  it("uses generic conflict copy when 409 has no detail", () => {
    expect(interpretSyncResponse(409, { accepted: false })).toEqual({
      ok: false,
      conflict: true,
      message: "Запрос уже выполняется",
    });
  });
});

describe("waitForPhonesSyncOutcome", () => {
  it("does not treat an existing success as the new job when the baseline is unknown", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      lastJobStatus: "success",
      lastError: null,
      lastFinishedAt: "2026-01-01T00:00:00.000Z",
      runningCount: 0,
    });

    const result = await waitForPhonesSyncOutcome({
      beforeFinishedAt: null,
      baselineKnown: false,
      fetchStatus,
      timeoutMs: 5,
      intervalMs: 1,
      sleepFn: async () => undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/ожидания/i);
  });
});
