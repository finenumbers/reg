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

describe("candidateFromSatelRow roles", () => {
  it("keeps in and out Call-IDs in separate sets", () => {
    const cand = candidateFromSatelRow(
      row({
        inLegCallId: "in-1",
        srcInLegCallId: "in-src",
        outLegCallId: "out-1",
        srcOutLegCallId: "",
      }),
    );
    expect(cand?.inCallIds).toEqual(["in-1", "in-src"]);
    expect(cand?.outCallIds).toEqual(["out-1"]);
    expect(cand?.sipCallIds[0]).toBe("out-1");
  });

  it("does not treat an in Call-ID as out when out fields are empty", () => {
    const cand = candidateFromSatelRow(row({ inLegCallId: "only-in" }));
    expect(cand?.inCallIds).toEqual(["only-in"]);
    expect(cand?.outCallIds).toEqual([]);
  });
});

describe("candidateFromSatelRow duration", () => {
  it("treats elapsed_time as milliseconds and ceils to seconds", () => {
    expect(candidateFromSatelRow(row())?.durationSec).toBe(25);
    expect(candidateFromSatelRow(row({ elapsedTime: "926" }))?.durationSec).toBe(
      1,
    );
    expect(candidateFromSatelRow(row({ elapsedTime: "" }))?.durationSec).toBeNull();
  });

  it("reads connect/disconnect as civil digits", () => {
    expect(
      candidateFromSatelRow(
        row({
          connectTime: "2026-08-27 20:04:19",
          disconnectTime: "2026-08-27 20:05:19",
        }),
      )?.connectDurationSec,
    ).toBe(60);
  });
});
