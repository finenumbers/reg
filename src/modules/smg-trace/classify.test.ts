import { describe, expect, it } from "vitest";
import {
  AF_CATEGORY,
  AF_STATUS,
  classifyAntifraud,
} from "@/modules/smg-trace/classify";
import type { TraceBlocks } from "@/modules/smg-trace/types";

function card(text: string, mismatch = false): TraceBlocks {
  return { text, mismatch };
}

function labels(closed: boolean, text: string, mismatch = false) {
  return classifyAntifraud({ closed, blocks: card(text, mismatch) });
}

const ACCEPT_IN = [
  "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
  "RADIUS: Accs-Request [antifraud]",
  "Request ID [078] is sent",
  "h323-call-origin                 = 'originate'",
  "Request ID [078] got valid reply for accs (in 27 ms)",
  "Request ID [078] Accs-Reply [accept]. Time [27:27]",
].join("\n");

const ACCEPT_OUT = [
  "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
  "RADIUS: Accs-Request [antifraud_out]",
  "Request ID [079] is sent",
  "h323-call-origin                 = 'answer'",
  "Request ID [079] got valid reply for accs (in 20 ms)",
  "Request ID [079] Accs-Reply [accept]. Time [20:20]",
].join("\n");

describe("classifyAntifraud", () => {
  it("names an open card once every sent request has a verdict", () => {
    expect(labels(false, `${ACCEPT_IN}\n${ACCEPT_OUT}`)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
  });

  it("keeps an open card waiting until a request is sent", () => {
    expect(labels(false, "")).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(
      labels(false, "Accs-Request for Antifraud: check TG(i/o): 5(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4."),
    ).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
  });

  const OUTSIDE = [
    "Port SIPT:0113. Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4.",
    "Port SIPT:0113. Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 4.",
    "Port SIPT:0511. Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 5.",
  ].join("\n");

  it("names an open call outside the scheme once both routed stages are off", () => {
    expect(labels(false, OUTSIDE)).toEqual({
      category: AF_CATEGORY.notSent,
      status: AF_STATUS.noRequest,
    });
    expect(labels(true, OUTSIDE)).toEqual({
      category: AF_CATEGORY.notSent,
      status: AF_STATUS.noRequest,
    });
  });

  it("does not treat a probe or one routed stage as outside the scheme", () => {
    const probeAndIn = OUTSIDE.split("\n").slice(0, 2).join("\n");
    expect(labels(false, probeAndIn)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, OUTSIDE.split("\n")[1] ?? "")).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
  });

  it("keeps waiting when a routed stage is not a clean off", () => {
    const dirty = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 4.",
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 1, RREQ 5.",
    ].join("\n");
    const foreign = [
      OUTSIDE,
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 6.",
    ].join("\n");
    expect(labels(false, dirty)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, foreign)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
  });

  it("does not name a mismatched card as not sent while it is open", () => {
    expect(labels(false, OUTSIDE, true)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(true, OUTSIDE, true)).toEqual({
      category: AF_CATEGORY.conflict,
      status: AF_STATUS.unknown,
    });
  });

  it("drops the outside label once a later stage sends", () => {
    const sent = [
      OUTSIDE,
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [013] is sent",
    ].join("\n");
    expect(labels(false, sent)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, `${OUTSIDE}\n${ACCEPT_OUT}`).category).toBe(AF_CATEGORY.passedOut);
  });

  it("keeps an open card waiting while any sent request has no verdict", () => {
    const sent = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [012] is sent",
    ].join("\n");
    const outPending = [
      ACCEPT_IN,
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [013] is sent",
    ].join("\n");
    expect(labels(false, sent)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, outPending)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
  });

  it("names a closed call with no antifraud lines", () => {
    expect(labels(true, "")).toEqual({
      category: AF_CATEGORY.notChecked,
      status: AF_STATUS.unknown,
    });
  });

  it("names a gateway that chose not to send", () => {
    expect(
      labels(true, "Accs-Request for Antifraud: check TG(i/o): 5(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4."),
    ).toEqual({
      category: AF_CATEGORY.notSent,
      status: AF_STATUS.noRequest,
    });
  });

  it("names a check that never sent a packet", () => {
    expect(
      labels(
        true,
        [
          "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
          "Accs-Request for Antifraud: no flags set - skip.",
        ].join("\n"),
      ).category,
    ).toBe(AF_CATEGORY.requestMissing);
  });

  it("calls both accepts passed, including a trailing skip", () => {
    const text = [
      ACCEPT_IN,
      ACCEPT_OUT,
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 0, RREQ 5.",
      "Accs-Request for Antifraud: no flags set - skip.",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
  });

  it("treats an old-firmware ignore plus reply as a pass", () => {
    const text = [
      ACCEPT_IN,
      "Accs-Request for Antifraud: check TG(i/o): 27(ext)/26(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [085] send. Attempt: 1. Srv-grp [0]",
      "h323-call-origin                 = 'answer'",
      "Request ID [085] got valid reply for accs (in 171 ms)",
      "Request ID [085] process reply: ignore for not antifraud verify stage.",
    ].join("\n");
    expect(labels(false, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
  });

  it("keeps an ignored reject packet as a reject", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [011] send. Attempt: 1",
      "rc: Calculating digest on:",
      "rc:   030B001400000000000000000000000000000000",
      "rc: Calculated digest is:",
      "rc:   AAAAAAAAAAAAAAAA",
      "rc: Reply digest is:",
      "rc:   BBBBBBBBBBBBBBBB",
      "Request ID [011] got valid reply for accs (in 10 ms)",
      "Request ID [011] process reply: ignore for not antifraud verify stage.",
    ].join("\n");
    expect(labels(false, text).category).toBe(AF_CATEGORY.rejectIgnoredOut);
    expect(labels(true, text).category).toBe(AF_CATEGORY.rejectIgnoredOut);
  });

  it("does not let an early USE_AF 0 hide a sent accept", () => {
    const text = `Accs-Request for Antifraud: check TG(i/o): 5(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4.\n${ACCEPT_IN}`;
    expect(labels(false, text).category).toBe(AF_CATEGORY.passedIn);
    expect(labels(true, text).category).toBe(AF_CATEGORY.passedIn);
  });

  it("names an open reject before the release line and a block after it", () => {
    const sent = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [010] is sent",
      "Request ID [010] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(false, sent).category).toBe(AF_CATEGORY.rejectIgnoredIn);
    expect(labels(false, `${sent}\nCall rejected. cause 0x0015`).category).toBe(AF_CATEGORY.blockedIn);
  });

  it("blocks the leg that was rejected and released", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [010] is sent. Attempt: 2",
      "Request ID [010] Accs-Reply [reject]",
      "Call rejected. cause 0x0015",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.blockedIn,
      status: AF_STATUS.retryIn,
    });
  });

  it("keeps a reject that did not release the call", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [011] is sent",
      "Request ID [011] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.rejectIgnoredOut,
      status: AF_STATUS.firstTry,
    });
  });

  it("names a sent request with no verdict", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [012] is sent",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.noReply,
      status: AF_STATUS.noAnswer,
    });
  });

  it("keeps the retry status when the retried request still has no reply", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [013] send. Attempt: 2",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.noReply,
      status: AF_STATUS.retryIn,
    });
  });

  it("names a RADIUS release with no verdict", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [014] is sent",
      "RADIUS: release call",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.releasedNoReply,
      status: AF_STATUS.noAnswer,
    });
  });

  it("does not treat the CDR snapshot field as a release", () => {
    expect(labels(true, `${ACCEPT_IN}\nRADIUS server rejected: :0 (replied 0)`).category).toBe(
      AF_CATEGORY.passedIn,
    );
  });

  it("counts save_call as the wrong type without hiding a pass", () => {
    expect(labels(true, `${ACCEPT_IN}\nxpgk-request-type=save_call`)).toEqual({
      category: AF_CATEGORY.passedIn,
      status: AF_STATUS.wrongType,
    });
  });

  it("counts Attempt: 2 and a second request id as a retry", () => {
    const text = [
      ACCEPT_IN,
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [080] is sent",
      "Request ID [080] Accs-Reply [accept]",
    ].join("\n");
    expect(labels(true, text).status).toBe(AF_STATUS.retryIn);
    expect(labels(true, text).category).toBe(AF_CATEGORY.passedIn);
  });

  it("waits on an open mismatch until the replies are in", () => {
    expect(labels(false, ACCEPT_IN, true).category).toBe(AF_CATEGORY.conflict);
    expect(
      labels(
        false,
        [
          "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
          "RADIUS: Accs-Request [antifraud]",
          "Request ID [012] is sent",
        ].join("\n"),
        true,
      ).category,
    ).toBe(AF_CATEGORY.waiting);
  });

  it("flags two identities and accept plus reject on one leg", () => {
    expect(labels(true, ACCEPT_IN, true).category).toBe(AF_CATEGORY.conflict);
    const mixed = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [016] is sent",
      "Request ID [016] Accs-Reply [accept]",
      "Request ID [016] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(true, mixed).category).toBe(AF_CATEGORY.conflict);
  });

  it("drops an invalid digest and a timeout that continued the call", () => {
    const packet = (code: number, id: number) =>
      code.toString(16).padStart(2, "0") + id.toString(16).padStart(2, "0") + "0014" + "00".repeat(16);
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 29(ext)/28(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [078] send. Attempt: 2",
      "rc: Calculating digest on:",
      `rc:   ${packet(3, 78)}`,
      "rc: Calculated digest is:",
      "rc:   AAAAAAAAAAAAAAAA",
      "rc: Reply digest is:",
      "rc:   BBBBBBBBBBBBBBBB",
      "Request ID [078] received invalid reply accs. Silent ignore",
      "Request ID [078] srv-retries exhausted!",
      "RADIUS: release call request. Cause: 'timeout'",
      "RADIUS: release call. Accs. Cause[timeout]. RestrictOut[no restrict]. Link[y]",
      "Accs-Request for Antifraud: check TG(i/o): 29(ext)/28(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [107] send. Attempt: 2",
      "rc: Calculating digest on:",
      `rc:   ${packet(3, 107)}`,
      "rc: Calculated digest is:",
      "rc:   CCCCCCCCCCCCCCCC",
      "rc: Reply digest is:",
      "rc:   CCCCCCCCCCCCCCCC",
      "Request ID [107] got valid reply for accs (in 394 ms)",
      "Request ID [107] process reply: ignore for not antifraud verify stage.",
    ].join("\n");
    expect(labels(false, text)).toEqual({
      category: AF_CATEGORY.rejectIgnoredOut,
      status: AF_STATUS.retryBoth,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.rejectIgnoredOut,
      status: AF_STATUS.retryBoth,
    });
  });

  it("keeps an Accs-Reply reject when another request is silently ignored", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Request ID [011] is sent",
      "Request ID [011] Accs-Reply [reject]",
      "Request ID [099] received invalid reply accs. Silent ignore",
    ].join("\n");
    expect(labels(true, text).category).toBe(AF_CATEGORY.rejectIgnoredOut);
  });

  it("keeps waiting when one server is exhausted but the group is not", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Request ID [013] send. Attempt: 2",
      "Request ID [013] timeout! retries exhausted",
    ].join("\n");
    expect(labels(false, text).category).toBe(AF_CATEGORY.waiting);
  });
});
