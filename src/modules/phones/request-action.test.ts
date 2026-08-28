import { describe, expect, it } from "vitest";
import { interpretSyncResponse } from "@/modules/phones/request-action";

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
