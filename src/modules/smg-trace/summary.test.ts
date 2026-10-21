import { describe, expect, it } from "vitest";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";
import { formatServerLine, summarizeExchange } from "@/modules/smg-trace/summary";
import type { TraceBlocks } from "@/modules/smg-trace/types";

const DEV = "91.195.253.131";
const PROD = "91.195.252.131";
const PARKING = "5.227.161.183";
const SECRET = "super-secret";

function blocks(text: string, mismatch = false): TraceBlocks {
  return { text, mismatch };
}

function summary(closed: boolean, text: string, mismatch = false) {
  return summarizeExchange({ closed, blocks: blocks(text, mismatch) });
}

function linesOf(closed: boolean, text: string): string[] {
  return summary(closed, text).stages.flatMap((stage) => stage.servers.map((row) => formatServerLine(row)));
}

describe("antifraud exchange summary", () => {
  it("names a block after Dev and Prod time out and Parking rejects", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      `Access request ID[077]. Group[0] Server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID [077] is sent",
      `Access request ID[077]. Group[0] Server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      `Access request ID[078]. Group[0] Server[0]: ${DEV}:1812:${SECRET} is timed out`,
      `Request ID[078]. Skipping server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID[078]. Sequence number updated [078]->[079]",
      `Access request ID[079]. Group[0] Server[1]: ${PROD}:1812:${SECRET}`,
      "Request ID [079] is sent",
      "Request ID[079]. Resend request. Attempt 2 out of 2",
      `Access request ID[079]. Group[0] Server[0]: ${DEV}:1812:${SECRET} is timed out`,
      `Request ID[079]. Skipping server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID[079]. Sequence number updated [079]->[080]",
      `Access request ID[080]. Group[0] Server[1]: ${PROD}:1812:${SECRET}`,
      "Request ID [080] is sent",
      "Request ID[080]. Retries are exhausted",
      `Access request ID[081]. Group[0] Server[0]: ${DEV}:1812:${SECRET} is timed out`,
      `Access request ID[082]. Group[0] Server[1]: ${PROD}:1812:${SECRET} is timed out`,
      `Access request ID[083]. Group[0] Server[2]: ${PARKING}:1812:${SECRET}`,
      "Request ID [083] is sent",
      "Request ID [083] got valid reply for accs (in 55 ms)",
      "Request ID [083] Accs-Reply [reject]. Time [55:55]",
      "Cause '0x0015'",
      "Release local reason: RADIUS reject",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.blockedIn);
    expect(result.status).toBe(AF_STATUS.retryIn);
    expect(result.stages.map((stage) => stage.title)).toEqual(["Вход"]);
    expect(linesOf(true, text)).toEqual([
      `Dev Callhose ${DEV} — нет ответа, повторы исчерпаны, запрос 077`,
      `Prod Callhose ${PROD} — нет ответа, повторы исчерпаны, запросы 079 и 080`,
      `Parking ${PARKING} — Access-Reject, 55 мс, вызов снят, запрос 083`,
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("keeps one outgoing row when the same server accepts on the second try", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      `Access request ID[073]. Group[0] Server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID [073] is sent",
      "Request ID [073] got valid reply for accs (in 335 ms)",
      "Request ID [073] Accs-Reply [accept]. Time [336:335]",
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      `Access request ID[074]. Group[0] Server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID [074] is sent",
      "Request ID[074]. Resend request. Attempt 2 out of 2",
      `Access request ID[074]. Group[0] Server[0]: ${DEV}:1812:${SECRET}`,
      "Request ID [074] is sent",
      "Request ID [074] got valid reply for accs (in 94 ms)",
      "Request ID [074] Accs-Reply [accept]. Time [101:94]",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.passed);
    expect(result.status).toBe(AF_STATUS.retryOut);
    expect(linesOf(true, text)).toEqual([
      `Dev Callhose ${DEV} — Access-Accept, 335 мс, запрос 073`,
      `Dev Callhose ${DEV} — Access-Accept, 94 мс, запрос 074`,
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("passes on the next incoming server after a timeout", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Access request ID[077]. Group[0] Server[0]: 10.0.0.1:1812",
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      "Access request ID[079]. Group[0] Server[1]: 10.0.0.2:1812",
      "Request ID [079] is sent",
      "Request ID [079] got valid reply for accs (in 40 ms)",
      "Request ID [079] Accs-Reply [accept]",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.passedIn);
    expect(result.status).toBe(AF_STATUS.retryIn);
    expect(linesOf(true, text)).toEqual([
      "10.0.0.1 — нет ответа, повторы исчерпаны, запрос 077",
      "10.0.0.2 — Access-Accept, 40 мс, запрос 079",
    ]);
  });

  it("does not call an outgoing reject a release when the call continued", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/1(ext), USE_AF 1, SD 0, OS 1, RREQ 5.",
      "RADIUS: Accs-Request [antifraud_out]",
      "Access request ID[011]. Group[0] Server[0]: 10.0.0.4:1812",
      "Request ID [011] is sent",
      "Request ID [011] got valid reply for accs (in 10 ms)",
      "Request ID [011] Accs-Reply [reject]",
      "RADIUS: release call. Accs. Cause[timeout]. RestrictOut[no restrict]. Link[y]",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.rejectIgnoredOut);
    expect(result.status).toBe(AF_STATUS.firstTry);
    expect(linesOf(true, text)).toEqual(["10.0.0.4 — Access-Reject, 10 мс, запрос 011"]);
  });

  it("waits on the server that has not answered yet", () => {
    const text = [
      "RADIUS: Accs-Request [antifraud]",
      `Access request ID[077]. Group[0] Server[0]: ${DEV}:1812`,
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      `Access request ID[079]. Group[0] Server[1]: ${PROD}:1812`,
      "Request ID [079] is sent",
    ].join("\n");
    const result = summary(false, text);
    expect(result.category).toBe(AF_CATEGORY.waiting);
    expect(linesOf(false, text)).toEqual([
      `Dev Callhose ${DEV} — нет ответа, повторы исчерпаны, запрос 077`,
      `Prod Callhose ${PROD} — ждём ответ, запрос 079`,
    ]);
  });

  it("names a release when every sent request timed out", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      `Access request ID[077]. Group[0] Server[0]: ${DEV}:1812`,
      "Request ID [077] is sent",
      "Request ID[077]. Retries are exhausted",
      `Access request ID[079]. Group[0] Server[1]: ${PROD}:1812`,
      "Request ID [079] is sent",
      "Request ID[079]. Retries are exhausted",
      `Access request ID[083]. Group[0] Server[2]: ${PARKING}:1812`,
      "Request ID [083] is sent",
      "Request ID[083]. Retries are exhausted",
      "RADIUS: release call",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.releasedNoReply);
    expect(result.status).toBe(AF_STATUS.retryIn);
    expect(linesOf(true, text)).toEqual([
      `Dev Callhose ${DEV} — нет ответа, повторы исчерпаны, запрос 077`,
      `Prod Callhose ${PROD} — нет ответа, повторы исчерпаны, запрос 079`,
      `Parking ${PARKING} — нет ответа, повторы исчерпаны, запрос 083`,
    ]);
  });

  it("omits server rows when nothing was sent", () => {
    const off = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/0(ext), USE_AF 0, SD 0, OS 0, RREQ 4.",
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/0(ext), USE_AF 0, SD 0, OS 0, RREQ 5.",
    ].join("\n");
    expect(summary(true, off)).toEqual({
      category: AF_CATEGORY.notSent,
      status: AF_STATUS.noRequest,
      stages: [],
    });
    expect(summary(true, "Set Antifraud RADIUS-profile [0] options.").category).toBe(AF_CATEGORY.notChecked);
    expect(summary(true, "Set Antifraud RADIUS-profile [0] options.").stages).toEqual([]);
    const missing =
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4.";
    expect(summary(true, missing).category).toBe(AF_CATEGORY.requestMissing);
    expect(summary(true, missing).stages).toEqual([]);
  });

  it("keeps the servers when the card does not agree with itself", () => {
    const text = [
      "RADIUS: Accs-Request [antifraud]",
      "Access request ID[016]. Group[0] Server[0]: 10.9.8.7:1812",
      "Request ID [016] is sent",
      "Request ID [016] Accs-Reply [accept]",
      "Request ID [016] Accs-Reply [reject]",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.conflict);
    expect(linesOf(true, text)).toEqual(["10.9.8.7 — Access-Reject, запрос 016"]);
  });

  it("keeps a pass and names the wrong request type", () => {
    const text = [
      "Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 1, SD 1, OS 0, RREQ 4.",
      "RADIUS: Accs-Request [antifraud]",
      "Cisco-AVPair                     = 'xpgk-request-type=save_call'",
      "Access request ID[073]. Group[0] Server[0]: 10.0.0.1:1812",
      "Request ID [073] is sent",
      "Request ID [073] got valid reply for accs (in 12 ms)",
      "Request ID [073] Accs-Reply [accept]",
    ].join("\n");
    const result = summary(true, text);
    expect(result.category).toBe(AF_CATEGORY.passedIn);
    expect(result.status).toBe(AF_STATUS.wrongType);
    expect(linesOf(true, text)).toEqual(["10.0.0.1 — Access-Accept, 12 мс, запрос 073"]);
  });
});
