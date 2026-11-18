import { describe, expect, it } from "vitest";
import {
  calltraceCells,
  classifyCallId,
  collectLegCdrIds,
  parseVoipmonitorLegs,
  RTP_ABSENT,
  RTP_PRESENT,
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

describe("parseVoipmonitorLegs audio", () => {
  it("keeps a boolean and ignores a string", () => {
    expect(
      parseVoipmonitorLegs({
        out: { url: "https://vm/a", cdrId: "1", callId: "out", audio: false },
        in: { url: "https://vm/b", cdrId: "2", callId: "in", audio: "true" },
      }),
    ).toEqual({
      out: { url: "https://vm/a", cdrId: "1", callId: "out", audio: false },
      in: { url: "https://vm/b", cdrId: "2", callId: "in" },
    });
  });
});

describe("calltrace RTP mark", () => {
  const gui = "https://vm.example";
  const outUrl = "https://vm.example/admin.php?cdr_filter=%7B%7D";
  const inUrl = "https://vm.example/admin.php?cdr_filter=%7Bok%7D";

  it("reads Out and does not fall back when Out has no codec key", () => {
    expect(
      calltraceCells(
        {
          out: { url: outUrl, cdrId: "9", callId: "out", audio: false },
          in: { url: inUrl, cdrId: "8", callId: "in", audio: true },
        },
        gui,
      ).rtp,
    ).toBe(RTP_ABSENT);
    expect(
      calltraceCells(
        {
          out: { url: outUrl, cdrId: "9", callId: "out" },
          in: { url: inUrl, cdrId: "8", callId: "in", audio: true },
        },
        gui,
      ).rtp,
    ).toBe("");
  });

  it("reads In only when Out is not shown", () => {
    expect(
      calltraceCells(
        { in: { url: inUrl, cdrId: "8", callId: "in", audio: true } },
        gui,
      ).rtp,
    ).toBe(RTP_PRESENT);
    expect(
      calltraceCells(
        {
          out: { url: "javascript:alert(1)", cdrId: "9", callId: "out", audio: false },
          in: { url: inUrl, cdrId: "8", callId: "in", audio: true },
        },
        gui,
      ).rtp,
    ).toBe(RTP_PRESENT);
    expect(
      calltraceCells(
        {
          out: { url: outUrl, cdrId: "9", callId: "out", audio: true },
          in: { url: inUrl, cdrId: "8", callId: "in", audio: false },
        },
        "",
      ).rtp,
    ).toBe("");
    expect(
      calltraceCells(
        {
          out: { url: "https://other.example/a", cdrId: "9", callId: "out", audio: true },
        },
        gui,
      ).rtp,
    ).toBe("");
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
