import { describe, expect, it } from "vitest";
import {
  AF_CATEGORY,
  AF_STATUS,
  classifyAntifraud,
} from "@/modules/smg-trace/classify";
import type { TraceBlocks, TraceLeg } from "@/modules/smg-trace/types";

function leg(patch: Partial<TraceLeg> = {}): TraceLeg {
  return {
    side: "",
    requestId: "",
    requestType: "number",
    origin: "",
    attempts: "",
    sessionId: "",
    profile: "",
    tg: "",
    reason: "",
    wait: "",
    server: "",
    numbers: "",
    useAf: "",
    attributes: [],
    reply: "",
    replyCode: "",
    replyAttributes: [],
    replyTime: "",
    ignored: "",
    released: "",
    notes: [],
    ...patch,
  };
}

function blocks(patch: Partial<TraceBlocks["antifraud"]> = {}, rest: Partial<TraceBlocks> = {}): TraceBlocks {
  return {
    antifraud: {
      summary: "",
      rejecting: "",
      mismatch: false,
      notes: [],
      legs: [],
      ...patch,
    },
    signal: rest.signal ?? [],
    numbers: rest.numbers ?? [],
    times: rest.times ?? [],
    media: rest.media ?? [],
  };
}

function labels(closed: boolean, card: TraceBlocks) {
  return classifyAntifraud({ closed, blocks: card });
}

describe("classifyAntifraud", () => {
  it("keeps an open card unlabeled so a late reject cannot replace a pass", () => {
    const card = blocks({
      legs: [leg({ side: "in", requestId: "1", reply: "accept", replyCode: "2 Access-Accept" })],
    });
    expect(labels(false, card)).toEqual({
      category: AF_CATEGORY.noData,
      status: AF_STATUS.unknown,
    });
  });

  it("names a finished call the gateway checked and did not send", () => {
    const card = blocks({
      legs: [leg({ useAf: "0", tg: "1(ext)/0(ext), RREQ 4" })],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.notSent,
      status: AF_STATUS.noRequest,
    });
  });

  it("does not treat a tail without the call start as unconsidered", () => {
    expect(labels(true, blocks())).toEqual({
      category: AF_CATEGORY.noData,
      status: AF_STATUS.unknown,
    });
  });

  it("names a finished call that never reached antifraud", () => {
    const card = blocks({}, { times: [{ port: "SIPT:1", event: "Setup", stamp: "t", delta: "" }] });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.notConsidered,
      status: AF_STATUS.unknown,
    });
  });

  it("names a check that was supposed to send and did not", () => {
    const card = blocks({ legs: [leg({ useAf: "1", side: "in" })] });
    expect(labels(true, card).category).toBe(AF_CATEGORY.requestMissing);
  });

  it("ignores the no-flags pass and the empty server-rejected field", () => {
    const card = blocks({
      rejecting: ":0",
      legs: [
        leg({
          side: "in",
          origin: "originate",
          requestId: "1",
          reply: "accept",
          replyCode: "2 Access-Accept",
        }),
        leg({
          side: "out",
          origin: "answer",
          requestId: "2",
          ignored: "ignore for not antifraud verify stage",
          replyCode: "2 Access-Accept",
        }),
        leg({ useAf: "1" }),
      ],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.passedOutIgnored,
      status: AF_STATUS.firstTry,
    });
  });

  it("keeps a resend on the status and the final reject on the category", () => {
    const card = blocks({
      legs: [
        leg({
          side: "in",
          requestId: "166",
          attempts: "2 of 3",
          reply: "reject",
          replyCode: "3 Access-Reject",
          released: "Call rejected. cause 0x0015",
        }),
      ],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.blockedIn,
      status: AF_STATUS.retryIn,
    });
  });

  it("does not call a bare Call rejected a RADIUS release", () => {
    const card = blocks({
      legs: [
        leg({
          side: "in",
          requestId: "1",
          reply: "accept",
          released: "Release, cause 'Call rejected'",
        }),
        leg({
          side: "out",
          requestId: "2",
          reply: "accept",
          replyCode: "2 Access-Accept",
        }),
      ],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.passedBoth,
      status: AF_STATUS.firstTry,
    });
  });

  it("marks a foreign request type without hiding the block", () => {
    const card = blocks({
      legs: [
        leg({
          side: "in",
          requestId: "1",
          requestType: "check_call",
          reply: "reject",
          replyCode: "3 Access-Reject",
          released: "RADIUS: release call. cause '0x0015'",
        }),
      ],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.blockedIn,
      status: AF_STATUS.wrongType,
    });
  });

  it("names a timeout with no code as a pass, and a missing code as unrecorded", () => {
    const timedOut = blocks({
      legs: [leg({ side: "in", requestId: "1", attempts: "3 of 3" })],
    });
    expect(labels(true, timedOut)).toEqual({
      category: AF_CATEGORY.passedWithoutReply,
      status: AF_STATUS.timeout,
    });
    const missing = blocks({ legs: [leg({ side: "in", requestId: "1" })] });
    expect(labels(true, missing)).toEqual({
      category: AF_CATEGORY.replyUnrecorded,
      status: AF_STATUS.codeMissing,
    });
  });

  it("names the single-leg shapes and a retry on the ignored outgoing leg", () => {
    expect(
      labels(true, blocks({ legs: [leg({ side: "in", requestId: "1", reply: "accept" })] })).category,
    ).toBe(AF_CATEGORY.passedIn);
    expect(
      labels(true, blocks({ legs: [leg({ side: "out", requestId: "1", reply: "accept" })] })).category,
    ).toBe(AF_CATEGORY.passedOut);
    expect(
      labels(true, blocks({
        legs: [leg({ side: "out", requestId: "1", ignored: "ignore for not antifraud" })],
      })).category,
    ).toBe(AF_CATEGORY.outOnlyIgnored);

    const retriedOut = blocks({
      legs: [
        leg({ side: "in", requestId: "1", reply: "accept" }),
        leg({
          side: "out",
          requestId: "2",
          attempts: "2 of 3",
          ignored: "ignore for not antifraud verify stage",
        }),
      ],
    });
    expect(labels(true, retriedOut)).toEqual({
      category: AF_CATEGORY.passedOutIgnored,
      status: AF_STATUS.retryOut,
    });
  });

  it("stops when the printed reply and the packet code disagree", () => {
    const card = blocks({
      legs: [leg({ side: "in", requestId: "1", reply: "accept", replyCode: "3 Access-Reject" })],
    });
    expect(labels(true, card).category).toBe(AF_CATEGORY.conflict);
  });

  it("stops when the gateway released the call without an Access-Reject", () => {
    const card = blocks({
      legs: [
        leg({
          side: "in",
          requestId: "1",
          released: "Release local reason: RADIUS reject",
        }),
      ],
    });
    expect(labels(true, card)).toEqual({
      category: AF_CATEGORY.releasedWithoutReply,
      status: AF_STATUS.timeout,
    });
  });
});
