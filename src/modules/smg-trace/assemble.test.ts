import { gzipSync } from "node:zlib";
import { appendFileSync, mkdtempSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyText,
  commitTraceFile,
  emptyTraceState,
  projectSpan,
  SMG_TRACE_PARSER_VERSION,
  type TraceSpan,
} from "@/modules/smg-trace/assemble";
import { decideTraceRows } from "@/modules/smg-trace/match";
import { traceSearchKeys } from "@/modules/smg-trace/tag";
import {
  listTraceSources,
  listTraceSourcesSince,
  LIVE_FILE_KEY,
  replayDevice,
  stepDevice,
  type TraceRepository,
} from "@/modules/smg-trace/walk";

const TAG = "110003366ad22499cb71df5e013ba801";
const TAG_SPACED = "11000336 6ad22499 cb71df5e 013ba801";
const ANSWER = "110004366ad22499398739c8732bb1a7";
const SECRET = "VzZohgq6Z1bmG0A61FlrctsL";

function line(callref: string, body: string): string {
  return `<14> <smg1016m>  13:20:25.326000  [INFO] [${callref}] ${body}`;
}

function rc(body: string): string {
  return `<14> <smg1016m>  13:20:25.850000  [INFO] rc: ${body}`;
}

function spansOf(text: string): TraceSpan[] {
  const state = emptyTraceState();
  const detached = applyText(state, text);
  return [...detached, ...Object.values(state.spans)];
}

function cisco(text: string): Buffer {
  const raw = Buffer.from(text, "latin1");
  const vendor = Buffer.alloc(6 + raw.length);
  vendor.writeUInt32BE(9, 0);
  vendor[4] = 0x66;
  vendor[5] = raw.length + 2;
  raw.copy(vendor, 6);
  return vendor;
}

function packetHex(code: number, id: number, values: Buffer[]): string {
  const attrs = values.map((value) => {
    const buf = Buffer.alloc(value.length + 2);
    buf[0] = 26;
    buf[1] = value.length + 2;
    value.copy(buf, 2);
    return buf;
  });
  const reply = Buffer.from("cause=50", "latin1");
  if (code === 3) {
    const buf = Buffer.alloc(reply.length + 2);
    buf[0] = 18;
    buf[1] = reply.length + 2;
    reply.copy(buf, 2);
    attrs.push(buf);
  }
  const body = Buffer.concat(attrs);
  const header = Buffer.alloc(20);
  header[0] = code;
  header[1] = id;
  header.writeUInt16BE(20 + body.length, 2);
  const packet = Buffer.concat([header, body]);
  const secret = Buffer.from(SECRET, "latin1");
  return Buffer.concat([packet, secret]).toString("hex").toUpperCase();
}

describe("SMG syslog call assembly", () => {
  it("keeps both RADIUS legs on the UniqueTag and treats the answer session as a leg", () => {
    const text = [
      line("C02AC3B", "SS7/ISUP. RX. IAM- Initial Address Message"),
      line("C02AC3B", "		# Calling party number: 03 13"),
      line("C02AC3B", "		# 	Number:            9516059476"),
      line("C02AC3B", "		# Called party number: 02 90"),
      line("C02AC3B", "		# 	Number:            3842222200"),
      line("C02AC3B", "Port SS7:01:31. Modify at 'incoming': number mask <(xxxxxxxxxx)>"),
      line("C02AC3B", "Port SS7:01:31. Modify at 'incoming': rule <+7$>, ptr <0>."),
      line("C02AC3B", "Port SS7:01:31. Modify at 'incoming': result-num: <79516059476>."),
      line("C02AC3B", "Port SS7:01:31. Accs-Request for Antifraud: check TG(i/o): 25(ext)/24(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C02AC3B", "Port SS7:01:31. RADIUS: Accs-Request [antifraud]"),
      line("C02AC3B", "Port SS7:01:31. RADIUS: Antifraud-Auth-Request clg <79516059476>, cld <73842222200>"),
      line("C02AC3B", "Port SS7:01:31. Dial Proc Continue - wait for Antifraud RADIUS-reply."),
      line("C02AC3B", "RADIUS. Request proc. Request ID[075]. Processing Antifraud-Auth-Request"),
      line("C02AC3B", `RADIUS. Send request. Access request ID[075]. Group[0] Server[0]: 91.195.253.131:1812:${SECRET}`),
      line("C02AC3B", "-- RADIUS. Antifraud-Auth-Request [075] --"),
      line("C02AC3B", "Password                         = ''"),
      line("C02AC3B", `h323-conf-id                     = '${TAG_SPACED}'`),
      line("C02AC3B", "h323-call-origin                 = 'originate'"),
      line("C02AC3B", "Cisco-AVPair                     = 'xpgk-request-type=number'"),
      line("C02AC3B", "Acct-Session-Id                  = '" + TAG_SPACED + "'"),
      line("C02AC3B", "--------------------------------"),
      rc("Calculating digest on:"),
      rc(`  ${packetHex(2, 75, [cisco("h323-credit-time=3600")])}`),
      rc("Calculated digest is:"),
      line("C02AC3B", "Port SS7:01:31. RADIUS: Request ID [075] got valid reply for accs (in 187 ms)"),
      line("C02AC3B", "RADIUS. Proc Reply. Request ID [075] Accs-Reply [accept]. Time [188:187]"),
      line("C02AC3B", "Port SIPT:0436. Set UniqueTag: '" + TAG_SPACED + "'"),
      line("C02AC3B", "Port SIPT:0436. Accs-Request for Antifraud: check TG(i/o): 25(ext)/24(ext), USE_AF 1, SD 0, OS 1, RREQ 5."),
      line("C02AC3B", "Port SIPT:0436. RADIUS: Accs-Request [antifraud_out]"),
      line("C02AC3B", "RADIUS. Request proc. Request ID[071]. Processing Antifraud-Auth-Request"),
      line("C02AC3B", "-- RADIUS. Antifraud-Auth-Request [071] --"),
      line("C02AC3B", "h323-conf-id                     = '" + TAG_SPACED + "'"),
      line("C02AC3B", "h323-call-origin                 = 'answer'"),
      line("C02AC3B", "Acct-Session-Id                  = '11000436 6ad22499 398739c8 732bb1a7'"),
      line("C02AC3B", "--------------------------------"),
      rc("Calculating digest on:"),
      rc(`  ${packetHex(2, 71, [cisco("h323-credit-time=3600")])}`),
      rc("Calculated digest is:"),
      line("C02AC3B", "RADIUS. Proc Reply. Request ID [071] ignore for not antifraud verify stage"),
      line("C02AC3B", "SIP. Callref 0436. Call-ID <1792-156825-743008>"),
      line("C02AC3B", "Port SS7:01:31. Setup   time-stamp: 13:20:25.326 GMT Fri Oct 16 2026"),
      line("C02AC3B", "Port SS7:01:31. Answer  time-stamp: 13:20:27.274 GMT Fri Oct 16 2026, msec-diff: 2948"),
      line("C02AC3B", "SIP. Callref 0436. Use codec: G711.A sendrecv. PT 8, PTE 20."),
      line("C02AC3B", "		 m[0]: audio 50642 RTP/AVP 8 0 101"),
      line("C02AC3B", "		 dtmf_mode 'rfc2833'"),
      line("C02AC3B", "		 unique tag:        '" + TAG_SPACED + "'"),
      line("C02AC3B", "Port SS7:01:31. Release time-stamp: 13:20:33.654 GMT Fri Oct 16 2026, msec-diff: 6328"),
      line("C02AC3B", "		 RADIUS server rejected: :0 (replied 0)"),
    ].join("\n");

    const spans = spansOf(text);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.tag).toBe(TAG);
    expect(span.echoed).toBe(true);
    expect(span.mismatch).toBe(false);
    expect(span.rejecting).toBe(":0");
    const blocks = projectSpan(span);
    expect(JSON.stringify(blocks)).not.toContain(SECRET);
    expect(blocks.antifraud.summary).toContain("RADIUS");
    expect(blocks.antifraud.legs).toHaveLength(2);
    const incoming = blocks.antifraud.legs[0]!;
    const outgoing = blocks.antifraud.legs[1]!;
    expect(incoming.side).toBe("in");
    expect(incoming.requestId).toBe("075");
    expect(incoming.requestType).toBe("number");
    expect(incoming.server).toBe("91.195.253.131:1812");
    expect(incoming.attributes.find((attr) => attr.name === "Password")?.value).toBe("пусто");
    expect(incoming.reply).toBe("accept");
    expect(incoming.replyTime).toBe("188:187");
    expect(incoming.replyCode).toBe("2 Access-Accept");
    expect(incoming.replyAttributes.map((attr) => attr.value)).toContain("3600");
    expect(outgoing.side).toBe("out");
    expect(outgoing.origin).toBe("answer");
    expect(outgoing.sessionId).toContain("11000436");
    expect(outgoing.sessionId.replace(/\s+/g, "")).not.toBe(TAG);
    expect(outgoing.ignored).toContain("ignore for not antifraud");
    expect(outgoing.replyCode).toBe("2 Access-Accept");
    expect(blocks.numbers.map((step) => step.text)).toEqual(
      expect.arrayContaining(["маска (xxxxxxxxxx)", "правило +7$", "после 79516059476"]),
    );
    expect(blocks.signal.some((leg) => leg.messages.includes("IAM"))).toBe(true);
    expect(blocks.signal.some((leg) => leg.callId === "1792-156825-743008")).toBe(true);
    expect(blocks.times[0]?.stamp).toContain("GMT");
    expect(blocks.times.find((row) => row.event === "Answer")?.delta).toBe("2948 ms");
    expect(blocks.media[0]?.codec).toBe("G711.A");
    expect(blocks.media[0]?.payload).toBe("8");
    expect(blocks.media[0]?.ptime).toBe("20");
    expect(blocks.media.some((leg) => leg.dtmf === "rfc2833")).toBe(true);
    expect(span.tag).not.toBe(ANSWER);
  });

  it("stores a resend on the same request id and keeps Time as printed", () => {
    const text = [
      line("C02AC5B", "Port SIPT:0001. Accs-Request for Antifraud: check TG(i/o): 1(ext)/2(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C02AC5B", "timeout! resend. Attempt: 2 of 3. Request ID[146]"),
      line("C02AC5B", "RADIUS. Proc Reply. Request ID [146] Accs-Reply [accept]. Time [150:149]"),
      line("C02AC5B", "Port SIPT:0001. Set UniqueTag: '" + TAG_SPACED + "'"),
    ].join("\n");
    const [span] = spansOf(text);
    const leg = projectSpan(span!).antifraud.legs[0]!;
    expect(leg.attempts).toBe("2 of 3");
    expect(leg.requestId).toBe("146");
    expect(leg.replyTime).toBe("150:149");
    expect(projectSpan(span!).antifraud.legs).toHaveLength(1);
  });

  it("records Access-Reject without inventing the outgoing leg or translating the cause", () => {
    const text = [
      line("C02A0CA", "Port SIPT:0001. Accs-Request for Antifraud: check TG(i/o): 1(ext)/2(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C02A0CA", "RADIUS. Request proc. Request ID[146]. Processing Antifraud-Auth-Request"),
      line("C02A0CA", "Port SIPT:0001. Set UniqueTag: '" + TAG_SPACED + "'"),
      rc("Calculating digest on:"),
      rc(`  ${packetHex(3, 146, [])}`),
      rc("Calculated digest is:"),
      line("C02A0CA", "RADIUS. Proc Reply. Request ID [146] Accs-Reply [reject]."),
      line("C02A0CA", "Port SIPT:0001. Call rejected. cause 0x0015"),
    ].join("\n");
    const blocks = projectSpan(spansOf(text)[0]!);
    expect(blocks.antifraud.legs).toHaveLength(1);
    const leg = blocks.antifraud.legs[0]!;
    expect(leg.replyCode).toBe("3 Access-Reject");
    expect(leg.replyAttributes.map((attr) => `${attr.name}=${attr.value}`)).toContain(
      "Reply-Message=cause=50",
    );
    expect(leg.released).toContain("0x0015");
    const bare = projectSpan(
      spansOf(
        [
          line("C02A0CB", "Port SIPT:0001. Accs-Request for Antifraud: check TG(i/o): 1(ext)/2(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
          line("C02A0CB", "RADIUS. Request proc. Request ID[147]. Processing Antifraud-Auth-Request"),
          line("C02A0CB", "Port SIPT:0001. Release, cause 'Call rejected'"),
        ].join("\n"),
      )[0]!,
    );
    expect(bare.antifraud.legs[0]?.released).toBe("");
    expect(JSON.stringify(blocks)).not.toContain("21");
    expect(leg.side).toBe("in");
  });

  it("does not give a later packet to a request that already finished", () => {
    const first = "11000000000000000000000000000001";
    const second = "11000000000000000000000000000002";
    const text = [
      line("C02A04A", "RADIUS. Request proc. Request ID[146]. Processing Antifraud-Auth-Request"),
      line("C02A04A", `Port SIPT:0001. Set UniqueTag: '${first}'`),
      rc("Calculating digest on:"),
      rc(`  ${packetHex(2, 146, [cisco("h323-credit-time=3600")])}`),
      rc("Calculated digest is:"),
      line("C02A04A", "unique tag: '" + first + "'"),
      line("C02A0CA", "RADIUS. Request proc. Request ID[146]. Processing Antifraud-Auth-Request"),
      line("C02A0CA", `Port SIPT:0002. Set UniqueTag: '${second}'`),
      rc("Calculating digest on:"),
      rc(`  ${packetHex(3, 146, [])}`),
      rc("Calculated digest is:"),
    ].join("\n");
    const spans = spansOf(text);
    const accept = spans.find((span) => span.tag === first)!;
    const reject = spans.find((span) => span.tag === second)!;
    expect(projectSpan(accept).antifraud.legs[0]?.replyCode).toBe("2 Access-Accept");
    expect(projectSpan(reject).antifraud.legs[0]?.replyCode).toBe("3 Access-Reject");
  });

  it("keeps a reply that arrives in the next file on the open call", () => {
    const state = emptyTraceState();
    applyText(
      state,
      [
        line("C02A0E3", "SS7/ISUP. RX. IAM- Initial Address Message"),
        line("C02A0E3", "RADIUS. Request proc. Request ID[196]. Processing Antifraud-Auth-Request"),
        line("C02A0E3", `Port SIPT:0001. Set UniqueTag: '${TAG_SPACED}'`),
      ].join("\n"),
    );
    applyText(
      state,
      [
        rc("Calculating digest on:"),
        rc(`  ${packetHex(2, 196, [cisco("h323-credit-time=3600")])}`),
        rc("Calculated digest is:"),
        line("C02A0E3", "Port SIPT:0001. CdPN: <73842222200>"),
      ].join("\n"),
    );
    const spans = Object.values(state.spans);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tag).toBe(TAG);
    expect(projectSpan(spans[0]!).antifraud.legs[0]?.replyCode).toBe("2 Access-Accept");
    expect(projectSpan(spans[0]!).numbers.map((step) => step.text)).toContain("CdPN 73842222200");
  });

  it("ignores an empty tag and a zero session id, then keeps the real tag", () => {
    const text = [
      line("C001850", "# RADIUS: session-ID [1100004f 00000000 00000000 00000000]"),
      line("C001850", "SIP. Callref 004f. UniqueTag ''"),
      line("C001850", "Port SIPT:004f. Accs-Request for Antifraud: check TG(i/o): 0(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4."),
      line("C001850", "Port SIPT:044f. Set UniqueTag: '1100004f 6ad1c91b 5e180e88 21612b36'"),
      "<11> <pa_sip>2026-10-16 06:50:01.618 ipc.c thread_3 !.PBXIPC: Decode ie 'ka_type'(169) failed",
    ].join("\n");
    const spans = spansOf(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tag).toBe("1100004f6ad1c91b5e180e8821612b36");
    const blocks = projectSpan(spans[0]!);
    expect(blocks.antifraud.summary).toContain("USE_AF 0");
    expect(blocks.antifraud.legs[0]?.replyCode).toBe("");
    expect(blocks.antifraud.legs[0]?.attributes).toEqual([]);
    expect(JSON.stringify(blocks)).not.toContain("ka_type");
  });

  it("flags an h323 value that is not the UniqueTag and does not open a second call", () => {
    const other = "1100000000000000000000000000000a";
    const text = [
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG_SPACED}'`),
      line("C0000F6", "-- RADIUS. Antifraud-Auth-Request [190] --"),
      line("C0000F6", `h323-conf-id                     = '${other}'`),
      line("C0000F6", "--------------------------------"),
    ].join("\n");
    const spans = spansOf(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tag).toBe(TAG);
    expect(spans[0]?.mismatch).toBe(true);
  });

  it("keeps release lines after the echo and starts the next call at the next tag", () => {
    const next = "1100000000000000000000000000000b";
    const text = [
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`),
      line("C0000F6", `unique tag: '${TAG_SPACED}'`),
      line("C0000F6", "Port SIPT:0001. Release time-stamp: 13:20:33.654 GMT Fri Oct 16 2026, msec-diff: 6328"),
      line("C0000F6", `Port SIPT:0002. Set UniqueTag: '${next}'`),
    ].join("\n");
    const spans = spansOf(text);
    expect(spans.map((span) => span.tag).sort()).toEqual([TAG, next].sort());
    const first = spans.find((span) => span.tag === TAG)!;
    expect(projectSpan(first).times.map((row) => row.event)).toContain("Release");
  });

  it("shows a 1970 stamp and does not split the call on it", () => {
    const text = [
      line("C0000F6", `Port SIPT:032d. Set UniqueTag: '${TAG}'`),
      line("C0000F6", "Port SIPT:032d. Setup   time-stamp: 00:00:00.000 GMT Thu Jan 01 1970"),
      line("C0000F6", "Port SIPT:0376. Release time-stamp: 00:00:01.000 GMT Fri Jan 30 1970, msec-diff: 1000"),
    ].join("\n");
    const spans = spansOf(text);
    expect(spans).toHaveLength(1);
    const stamps = projectSpan(spans[0]!).times.map((row) => row.stamp);
    expect(stamps.some((stamp) => stamp.includes("1970"))).toBe(true);
  });

  it("keeps an SS7 port and both request-id spellings", () => {
    const text = [
      line("C0000F6", "Port SS7:01:31. Query Next Digit - wait Antifraud RADIUS-reply"),
      line("C0000F6", "RADIUS. Request proc. Port SS7:01:31. Request ID [190]. Processing"),
      line("C0000F6", `Port SS7:01:31. Set UniqueTag: '${TAG}'`),
      line("C0000F6", "Port SS7:01:31. Setup   time-stamp: 13:51:56.272 MSK Fri Oct 16 2026"),
    ].join("\n");
    const blocks = projectSpan(spansOf(text)[0]!);
    expect(blocks.times[0]?.port).toBe("SS7:01:31");
    expect(blocks.times[0]?.stamp).toContain("MSK");
    expect(blocks.antifraud.legs[0]?.requestId).toBe("190");
    expect(blocks.antifraud.legs[0]?.wait).toContain("Query Next Digit");
  });

  it("does not store a password value", () => {
    const text = [
      line("C0000F6", "-- RADIUS. Antifraud-Auth-Request [10] --"),
      line("C0000F6", "Password                         = 'hunter2'"),
      line("C0000F6", "--------------------------------"),
      line("C0000F6", `Set UniqueTag: '${TAG}'`),
    ].join("\n");
    const json = JSON.stringify(projectSpan(spansOf(text)[0]!));
    expect(json).not.toContain("hunter2");
    expect(json).toContain("задано");
  });
});

describe("CDR card choice", () => {
  it("searches the normalized tag and skips a zero session id", () => {
    expect(traceSearchKeys(TAG_SPACED, "1100004f 00000000 00000000 00000000")).toEqual([TAG]);
    expect(traceSearchKeys("", "1100004f 00000000 00000000 00000000")).toEqual([]);
    expect(traceSearchKeys("UniqueTag ''", "")).toEqual([]);
  });

  it("shows one card and refuses two", () => {
    const blocks = projectSpan({
      callref: "C1",
      tag: TAG,
      mismatch: false,
      echoed: true,
      rejecting: "",
      party: "",
      lastPort: "",
      echoGeneration: null,
      ended: false,
      releaseGeneration: null,
      startedKey: "",
      lead: [],
      attempts: [],
      signal: [],
      numbers: [],
      times: [],
      media: [],
    });
    expect(decideTraceRows([])).toEqual({ status: "missing" });
    expect(
      decideTraceRows([{ deviceIp: "5.227.161.181", open: false, callref: "C1", blocks }]).status,
    ).toBe("ok");
    expect(
      decideTraceRows([
        { deviceIp: "5.227.161.181", open: false, callref: "C1", blocks },
        { deviceIp: "95.215.179.42", open: false, callref: "C9", blocks },
      ]),
    ).toEqual({ status: "ambiguous" });
  });
});

describe("call state between files", () => {
  it("keeps a call through the slot after release, then drops it", () => {
    const state = emptyTraceState();
    applyText(
      state,
      [
        line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`),
        line("C0000F6", `unique tag: '${TAG_SPACED}'`),
      ].join("\n"),
    );
    expect(commitTraceFile(state, 0, "10.1.2.3/2026/10/16/10/00").map((span) => span.tag)).toEqual([
      TAG,
    ]);
    expect(state.spans.C0000F6?.echoed).toBe(true);
    expect(state.spans.C0000F6?.ended).toBe(false);

    applyText(
      state,
      line(
        "C0000F6",
        "Port SIPT:0001. Release time-stamp: 13:20:33.654 GMT Fri Oct 16 2026, msec-diff: 6328",
      ),
    );
    const updated = commitTraceFile(state, 1, "10.1.2.3/2026/10/16/10/10");
    expect(updated.map((span) => span.tag)).toEqual([TAG]);
    expect(updated[0]?.times.some((row) => row.event === "Release")).toBe(true);
    expect(updated[0]?.ended).toBe(true);
    expect(state.spans.C0000F6).toBeDefined();

    commitTraceFile(state, 2, "10.1.2.3/2026/10/16/10/20");
    expect(state.spans.C0000F6).toBeUndefined();
  });

  it("ends a rejected call the same way", () => {
    const state = emptyTraceState();
    applyText(state, line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`));
    commitTraceFile(state, 0, "10.1.2.3/2026/10/16/10/00");
    applyText(state, line("C0000F6", "Port SIPT:0001. Call rejected. cause 0x0015"));
    const updated = commitTraceFile(state, 1, "10.1.2.3/2026/10/16/10/10");
    expect(updated[0]?.ended).toBe(true);
    expect(state.spans.C0000F6).toBeDefined();
    commitTraceFile(state, 2, "10.1.2.3/2026/10/16/10/20");
    expect(state.spans.C0000F6).toBeUndefined();
  });

  it("keeps an open call across an hour and drops it after four hours of slot time", () => {
    const state = emptyTraceState();
    applyText(state, line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`));
    commitTraceFile(state, 0, "10.1.2.3/2026/10/16/10/00");
    commitTraceFile(state, 1, "10.1.2.3/2026/10/16/11/00");
    expect(state.spans.C0000F6?.tag).toBe(TAG);
    const dropped = commitTraceFile(state, 2, "10.1.2.3/2026/10/16/14/00");
    expect(dropped.map((span) => span.tag)).toEqual([TAG]);
    expect(state.spans.C0000F6).toBeUndefined();
  });
});

describe("syslog file walk", () => {
  it("lists the open log ahead of a closed gzip and ignores a partial", () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "06");
    mkdirSync(hour, { recursive: true });
    const first = [
      line("C02A0E3", "RADIUS. Request proc. Request ID[196]. Processing Antifraud-Auth-Request"),
      line("C02A0E3", `Port SIPT:0001. Set UniqueTag: '${TAG}'`),
    ].join("\n");
    const second = [
      rc("Calculating digest on:"),
      rc(`  ${packetHex(2, 196, [cisco("h323-credit-time=3600")])}`),
      rc("Calculated digest is:"),
    ].join("\n");
    writeFileSync(path.join(hour, "00.log"), first);
    writeFileSync(path.join(hour, "00.log.gz"), gzipSync(Buffer.from("ignored")));
    writeFileSync(path.join(hour, "40.log.gz.partial"), gzipSync(Buffer.from("partial")));
    writeFileSync(path.join(hour, "50.log.gz"), gzipSync(Buffer.from(second)));

    const sources = listTraceSources(root);
    expect(sources.map((source) => `${source.fileKey}:${source.gzip ? "gz" : "log"}`)).toEqual([
      "10.1.2.3/2026/10/16/06/00:log",
      "10.1.2.3/2026/10/16/06/50:gz",
    ]);
  });

  it("does not read a slot that is already on disk", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const oldHour = path.join(root, "10.1.2.3", "2026", "10", "16", "07");
    const newHour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(oldHour, { recursive: true });
    mkdirSync(newHour, { recursive: true });
    writeFileSync(
      path.join(oldHour, "50.log.gz"),
      gzipSync(Buffer.from(line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n")),
    );
    writeFileSync(path.join(newHour, "00.log"), "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await replayDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
  });

  it("reads bytes appended after the mark and does not read them twice", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    writeFileSync(raw, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    const sources = () => listTraceSources(root);
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved).toEqual([]);
    appendFileSync(raw, line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n");
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved.map((row) => row.open)).toEqual([true]);
    const writes = saved.length;
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved).toHaveLength(writes);
  });

  it("keeps the call open across midnight until the slot after release", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const evening = path.join(root, "10.1.2.3", "2026", "10", "16", "23");
    const morning = path.join(root, "10.1.2.3", "2026", "10", "17", "00");
    mkdirSync(evening, { recursive: true });
    mkdirSync(morning, { recursive: true });
    const raw = path.join(evening, "50.log");
    writeFileSync(raw, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    const sources = () => listTraceSources(root);
    await stepDevice("10.1.2.3", sources(), repo.repo);
    appendFileSync(raw, line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n");
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved.at(-1)?.open).toBe(true);
    writeFileSync(
      path.join(morning, "00.log"),
      line(
        "C0000F6",
        "Port SIPT:0001. Release time-stamp: 00:05:00.000 GMT Sat Oct 17 2026, msec-diff: 1000",
      ) + "\n",
    );
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved.at(-1)?.open).toBe(false);
    expect(spansOfMark(repo).C0000F6).toBeDefined();
    writeFileSync(path.join(morning, "10.log"), "noise\n");
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(spansOfMark(repo).C0000F6).toBeUndefined();
  });

  it("does not open a gzip that replaced a fully read raw log", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    writeFileSync(raw, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    unlinkSync(raw);
    writeFileSync(
      path.join(hour, "00.log.gz"),
      gzipSync(Buffer.from(line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n")),
    );
    await replayDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
  });

  it("reads the unread tail after a raw log becomes gzip", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    const prefix = "noise\n";
    writeFileSync(raw, prefix);
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    const extra = line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n";
    const mark = repo.rows.get(LIVE_FILE_KEY)?.state as {
      tail: { key: string; rawSize: number };
    };
    mark.tail.rawSize = Buffer.byteLength(prefix + extra);
    unlinkSync(raw);
    writeFileSync(path.join(hour, "00.log.gz"), gzipSync(Buffer.from(prefix + extra)));
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG && row.open)).toBe(true);
  });

  it("drops a foreign mark without reading it and deletes cards when version 3 is absent", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const key = "10.1.2.3/2026/10/16/08/00";
    writeFileSync(
      path.join(hour, "00.log.gz"),
      gzipSync(Buffer.from(line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n")),
    );
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    repo.cards.add("already-there");
    repo.rows.set(key, { fileKey: key, size: 1, version: 2, state: { huge: true } });
    const previousState = repo.repo.loadCheckpointState.bind(repo.repo);
    repo.repo.loadCheckpointState = async (ip, fileKey) => {
      if (fileKey === key) throw new Error("read foreign json");
      return previousState(ip, fileKey);
    };
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(repo.cards.has("already-there")).toBe(false);
    expect(repo.rows.has(key)).toBe(false);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
  });

  it("keeps cards when a version-3 mark already exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    writeFileSync(raw, "noise\n");
    const key = "10.1.2.3/2026/10/16/08/00";
    const foreign = "10.1.2.3/2026/10/16/07/00";
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    repo.cards.add("keep");
    repo.rows.set(LIVE_FILE_KEY, {
      fileKey: LIVE_FILE_KEY,
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state: {
        floor: key,
        tail: { key, offset: Buffer.byteLength("noise\n"), rawSize: Buffer.byteLength("noise\n") },
        slotIndex: 0,
        slotKey: key,
        state: {
          spans: {},
          inflight: [],
          ambiguousIds: [],
          collecting: null,
          rcHex: "",
          rcActive: false,
          dirty: [],
        },
      },
    });
    repo.rows.set(foreign, { fileKey: foreign, size: 1, version: 2, state: { huge: true } });
    const previousState = repo.repo.loadCheckpointState.bind(repo.repo);
    repo.repo.loadCheckpointState = async (ip, fileKey) => {
      if (fileKey === foreign) throw new Error("read foreign json");
      return previousState(ip, fileKey);
    };
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(repo.cards.has("keep")).toBe(true);
    expect(repo.rows.has(foreign)).toBe(false);
  });

  it("lists the current slot before a mark and skips older slots after it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const older = path.join(root, "10.1.2.3", "2026", "10", "16", "07");
    const current = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(older, { recursive: true });
    mkdirSync(current, { recursive: true });
    writeFileSync(path.join(older, "00.log.gz"), gzipSync(Buffer.from("old\n")));
    writeFileSync(path.join(current, "00.log"), "now\n");
    const now = new Date("2026-10-16T08:05:00Z");
    expect(listTraceSourcesSince(root, "10.1.2.3", null, now).map((source) => source.fileKey)).toEqual([
      "10.1.2.3/2026/10/16/08/00",
    ]);
    expect(
      listTraceSourcesSince(root, "10.1.2.3", "10.1.2.3/2026/10/16/08/00").map((source) => source.fileKey),
    ).toEqual(["10.1.2.3/2026/10/16/08/00"]);
  });
});

function spansOfMark(repo: { rows: Map<string, { state: unknown }> }): Record<string, unknown> {
  const mark = repo.rows.get(LIVE_FILE_KEY)?.state as { state?: { spans?: Record<string, unknown> } };
  return mark.state?.spans ?? {};
}

function memoryRepo(saved: { tag: string; open: boolean }[]) {
  const rows = new Map<
    string,
    { fileKey: string; size: number; version: number; state: unknown }
  >();
  const cards = new Set<string>();
  const repo: TraceRepository = {
    async loadCheckpointMeta() {
      return [...rows.values()].map((row) => ({
        fileKey: row.fileKey,
        size: row.size,
        version: row.version,
      }));
    },
    async loadCheckpointState(_ip, fileKey) {
      return rows.get(fileKey)?.state ?? null;
    },
    async deleteStaleCheckpoints() {
      for (const [key, row] of rows) {
        if (row.version !== SMG_TRACE_PARSER_VERSION) rows.delete(key);
      }
    },
    async deleteCards() {
      cards.clear();
    },
    async saveSpan(_ip, span) {
      cards.add(span.tag);
      saved.push({ tag: span.tag, open: !span.ended });
    },
    async saveCheckpoint(_ip, fileKey, size, state) {
      rows.set(fileKey, { fileKey, size, version: SMG_TRACE_PARSER_VERSION, state });
    },
  };
  return { repo, rows, cards };
}
