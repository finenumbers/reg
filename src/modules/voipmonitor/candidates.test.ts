import { describe, expect, it } from "vitest";
import { candidateFromSatelRow, type SatelCdrRow } from "@/modules/voipmonitor/candidates";

function row(overrides: Partial<SatelCdrRow> = {}): SatelCdrRow {
  return {
    id: "1",
    cdrId: "c1",
    cdrAt: new Date("2026-08-28T11:20:05.000Z"),
    billAni: "7900",
    billDnis: "7499",
    inAni: "",
    inDnis: "",
    outAni: "",
    outDnis: "",
    elapsedTime: "24383",
    connectTime: "",
    disconnectTime: "",
    remoteSrcSigAddress: "",
    remoteDstSigAddress: "",
    localSrcSigAddress: "",
    localDstSigAddress: "",
    outLegCallId: "",
    srcOutLegCallId: "",
    inLegCallId: "",
    srcInLegCallId: "",
    srcInLegConfId: "",
    confId: "",
    ...overrides,
  };
}

describe("candidateFromSatelRow duration", () => {
  it("treats elapsed_time as milliseconds and ceils to seconds", () => {
    expect(candidateFromSatelRow(row())?.durationSec).toBe(25);
    expect(candidateFromSatelRow(row({ elapsedTime: "926" }))?.durationSec).toBe(
      1,
    );
    expect(candidateFromSatelRow(row({ elapsedTime: "" }))?.durationSec).toBeNull();
  });
});
