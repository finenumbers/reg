import { describe, expect, it } from "vitest";
import {
  classifyCallId,
  collectLegCdrIds,
  parseVoipmonitorLegs,
} from "@/modules/voipmonitor/legs";
import { SOURCE_SATEL, type CdrCandidate } from "@/modules/voipmonitor/types";

function cdr(partial: Partial<CdrCandidate>): CdrCandidate {
  return {
    sourceRecordId: "r",
    sourceSystem: SOURCE_SATEL,
    sourceCdrId: "c",
    setupTime: new Date("2026-07-27T12:00:00Z"),
    durationSec: null,
    connectDurationSec: null,
    caller: "",
    called: "",
    callerNumbers: [],
    calledNumbers: [],
    callerIp: "",
    calledIp: "",
    sipCallIds: [],
    inCallIds: [],
    outCallIds: [],
    inCaller: "",
    inCalled: "",
    outCaller: "",
    outCalled: "",
    inIp: "",
    outIp: "",
    ...partial,
  };
}

describe("parseVoipmonitorLegs", () => {
  it("reads in and out refs", () => {
    expect(
      parseVoipmonitorLegs({
        in: { url: "https://vm/a", cdrId: "1", callId: "in" },
        out: { url: "https://vm/b", cdrId: "2", callId: "out" },
      }),
    ).toEqual({
      in: { url: "https://vm/a", cdrId: "1", callId: "in" },
      out: { url: "https://vm/b", cdrId: "2", callId: "out" },
    });
  });

  it("treats empty objects as missing", () => {
    expect(parseVoipmonitorLegs({})).toEqual({});
    expect(parseVoipmonitorLegs(null)).toEqual({});
  });
});

describe("classifyCallId", () => {
  it("does not use list order", () => {
    const row = cdr({ inCallIds: ["in-id"], outCallIds: ["out-id"] });
    expect(classifyCallId("in-id", row)).toEqual({ in: true, out: false });
    expect(classifyCallId("out-id", row)).toEqual({ in: false, out: true });
  });
});

describe("collectLegCdrIds", () => {
  it("returns both ids", () => {
    expect(
      collectLegCdrIds({
        in: { url: "a", cdrId: "1", callId: "x" },
        out: { url: "b", cdrId: "2", callId: "y" },
      }),
    ).toEqual(["1", "2"]);
  });
});
