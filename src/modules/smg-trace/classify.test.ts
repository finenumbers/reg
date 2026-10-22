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

const ACCEPT = [
  "Set RADIUS-profile [1] options.",
  "RADIUS: Accs-Request [out-seize]",
  "Request ID [189] is sent",
  "h323-call-origin                 = 'answer'",
  "Cisco-AVPair                     = 'xpgk-request-type=number'",
  "Request ID [189] got valid reply for accs (in 23 ms)",
  "Request ID [189] Accs-Reply [accept]. Time [23:23]",
].join("\n");

describe("classifyAntifraud", () => {
  it("names one out-seize accept as passed on the first try", () => {
    expect(labels(false, ACCEPT)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
    expect(labels(true, ACCEPT)).toEqual({
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

  it("does not treat USE_AF 0 probes as a decision", () => {
    const probes = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4.",
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 4.",
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 5.",
    ].join("\n");
    expect(labels(false, probes)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(true, probes)).toEqual({
      category: AF_CATEGORY.notChecked,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, probes, true)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(true, probes, true).category).toBe(AF_CATEGORY.conflict);
  });

  it("keeps waiting when probes are followed by a sent request with no verdict", () => {
    const sent = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 5.",
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [013] is sent",
    ].join("\n");
    expect(labels(false, sent)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(false, `${probes()}\n${ACCEPT}`).category).toBe(AF_CATEGORY.passed);
  });

  it("names a closed call with no exchange", () => {
    expect(labels(true, "")).toEqual({
      category: AF_CATEGORY.notChecked,
      status: AF_STATUS.unknown,
    });
    expect(labels(true, "Set Antifraud RADIUS-profile [0] options.")).toEqual({
      category: AF_CATEGORY.notChecked,
      status: AF_STATUS.unknown,
    });
  });

  it("names a profile that never sent a packet", () => {
    expect(labels(true, "Set RADIUS-profile [1] options.")).toEqual({
      category: AF_CATEGORY.requestMissing,
      status: AF_STATUS.unknown,
    });
  });

  it("does not turn ignore-for-not-antifraud into an accept", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [085] send. Attempt: 1. Srv-grp [0]",
      "h323-call-origin                 = 'answer'",
      "Request ID [085] got valid reply for accs (in 171 ms)",
      "Request ID [085] process reply: ignore for not antifraud verify stage.",
    ].join("\n");
    expect(labels(false, text)).toEqual({
      category: AF_CATEGORY.waiting,
      status: AF_STATUS.unknown,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.noReply,
      status: AF_STATUS.noAnswer,
    });
  });

  it("keeps a reject packet when the reply text says ignore", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
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
    expect(labels(false, text).category).toBe(AF_CATEGORY.rejectIgnored);
    expect(labels(true, text).category).toBe(AF_CATEGORY.rejectIgnored);
  });

  it("names an open reject before the release line and a block after it", () => {
    const sent = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [010] is sent",
      "Request ID [010] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(false, sent).category).toBe(AF_CATEGORY.rejectIgnored);
    expect(labels(false, `${sent}\nCall rejected. cause 0x0015`).category).toBe(AF_CATEGORY.blocked);
  });

  it("blocks the request that was rejected and released", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [010] is sent. Attempt: 2",
      "Request ID [010] Accs-Reply [reject]",
      "Call rejected. cause 0x0015",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.blocked,
      status: AF_STATUS.retry,
    });
  });

  it("keeps a reject that did not release the call", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [011] is sent",
      "Request ID [011] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.rejectIgnored,
      status: AF_STATUS.firstTry,
    });
  });

  it("names a sent request with no verdict", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [012] is sent",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.noReply,
      status: AF_STATUS.noAnswer,
    });
  });

  it("keeps the retry status when the retried request still has no reply", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [013] send. Attempt: 2",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.noReply,
      status: AF_STATUS.retry,
    });
  });

  it("names a RADIUS release with no verdict", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [014] is sent",
      "RADIUS: release call",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.releasedNoReply,
      status: AF_STATUS.noAnswer,
    });
  });

  it("does not treat the CDR snapshot field as a release", () => {
    expect(labels(true, `${ACCEPT}\nRADIUS server rejected: :0 (replied 0)`).category).toBe(
      AF_CATEGORY.passed,
    );
  });

  it("counts save_call as the wrong type without hiding a pass", () => {
    expect(labels(true, `${ACCEPT}\nxpgk-request-type=save_call`)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.wrongType,
    });
  });

  it("counts a second request id as a retry and keeps the later accept", () => {
    const text = [
      ACCEPT,
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [190] is sent",
      "Request ID [190] Accs-Reply [accept]",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.retry,
    });
  });

  it("passes after an earlier reject on another request", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [188] is sent",
      "Request ID [188] Accs-Reply [reject]",
      "Request ID [189] is sent",
      "Request ID [189] Accs-Reply [accept]",
    ].join("\n");
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.retry,
    });
  });

  it("waits on an open mismatch until a verdict exists", () => {
    expect(labels(false, ACCEPT, true).category).toBe(AF_CATEGORY.conflict);
    expect(
      labels(
        false,
        ["RADIUS: Accs-Request [out-seize]", "Request ID [012] is sent"].join("\n"),
        true,
      ).category,
    ).toBe(AF_CATEGORY.waiting);
  });

  it("flags two identities and accept plus reject on one request", () => {
    expect(labels(true, ACCEPT, true).category).toBe(AF_CATEGORY.conflict);
    const mixed = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [016] is sent",
      "Request ID [016] Accs-Reply [accept]",
      "Request ID [016] Accs-Reply [reject]",
    ].join("\n");
    expect(labels(true, mixed).category).toBe(AF_CATEGORY.conflict);
    expect(labels(false, mixed).category).toBe(AF_CATEGORY.conflict);
  });

  it("drops an invalid digest and does not release on a timeout that continued", () => {
    const packet = (code: number, id: number) =>
      code.toString(16).padStart(2, "0") + id.toString(16).padStart(2, "0") + "0014" + "00".repeat(16);
    const text = [
      "RADIUS: Accs-Request [out-seize]",
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
      category: AF_CATEGORY.rejectIgnored,
      status: AF_STATUS.retry,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.rejectIgnored,
      status: AF_STATUS.retry,
    });
  });

  it("keeps an Accs-Reply reject when another request is silently ignored", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [011] is sent",
      "Request ID [011] Accs-Reply [reject]",
      "Request ID [099] received invalid reply accs. Silent ignore",
    ].join("\n");
    expect(labels(true, text).category).toBe(AF_CATEGORY.rejectIgnored);
  });

  it("keeps waiting when one server is exhausted and the next request is not sent", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [013] send. Attempt: 2",
      "Request ID [013] timeout! retries exhausted",
    ].join("\n");
    expect(labels(false, text).category).toBe(AF_CATEGORY.waiting);
  });

  it("blocks a reject after earlier servers were left behind", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "h323-call-origin                 = 'answer'",
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      "Request ID [079] is sent",
      "Request ID[079]. Resend request. Attempt 2 out of 2",
      "Request ID [080] is sent",
      "Request ID[080]. Retries are exhausted",
      "Request ID [083] is sent",
      "Request ID [083] Accs-Reply [reject]",
      "Cause '0x0015'",
      "Release local reason: RADIUS reject",
    ].join("\n");
    expect(labels(false, text)).toEqual({
      category: AF_CATEGORY.blocked,
      status: AF_STATUS.retry,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.blocked,
      status: AF_STATUS.retry,
    });
  });

  it("passes on the next server after a timeout", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      "Request ID [079] is sent",
      "Request ID [079] Accs-Reply [accept]",
    ].join("\n");
    expect(labels(false, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.retry,
    });
    expect(labels(true, text)).toEqual({
      category: AF_CATEGORY.passed,
      status: AF_STATUS.retry,
    });
  });

  it("waits while the latest request has no reply", () => {
    const text = [
      "RADIUS: Accs-Request [out-seize]",
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      "Request ID [079] is sent",
    ].join("\n");
    expect(labels(false, text).category).toBe(AF_CATEGORY.waiting);
  });
});

function probes(): string {
  return [
    "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4.",
    "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 4.",
    "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 0, SD 0, OS 0, RREQ 5.",
  ].join("\n");
}
