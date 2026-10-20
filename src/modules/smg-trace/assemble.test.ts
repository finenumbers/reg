import { gzipSync } from "node:zlib";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  forgetCardsIfUnmarked,
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

function rcBlock(code: number, id: number): string[] {
  const hex = packetHex(code, id, [cisco("h323-credit-time=3600")]);
  return [
    rc("Calculating digest on:"),
    rc(`  ${hex}`),
    rc("Calculated digest is:"),
    rc("  AABBCCDDEEFF00112233445566778899"),
    rc("Reply digest is:"),
    rc("  AABBCCDDEEFF00112233445566778899"),
  ];
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
  it("keeps both legs, the secret, and the blank before the dump", () => {
    const text = [
      line("C0001B7", "Port SIPT:00da. Seize on version ECSS-10 ANTIFRAUD"),
      line("C0001B7", "# RADIUS: session-ID [110000da 00000000 00000000 00000000]"),
      line("C0001B7", "Port SIPT:00da. Seize. RADIUS=-1"),
      line("C0001B7", "Port SIPT:00da. Accs-Request for Antifraud: check TG(i/o): 5(ext)/-1(loc), USE_AF 0, SD 0, OS 0, RREQ 4."),
      line("C0001B7", "Port SS7:00:01. Check out-calling-from-RADIUS-modify: '4996660400'(10)."),
      line("C0001B7", `Port SS7:00:01. Set UniqueTag: '${TAG_SPACED}'`),
      line("C0001B7", "Port SS7:00:01. Set Antifraud RADIUS-profile [0] options."),
      line("C0001B7", "SS7/ISUP. RX. IAM- Initial Address Message"),
      line("C0001B7", "Port SIPT:00da. Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C0001B7", "Port SIPT:00da. RADIUS: Accs-Request [antifraud]"),
      line("C0001B7", "RADIUS. Request proc. Port SIPT:00da. Request ID[078]. Processing Antifraud-Auth-Request"),
      line("C0001B7", `RADIUS. Send request. Access request ID[078]. Group[0] Server[0]: 91.195.253.131:1812:${SECRET}`),
      line("C0001B7", "RADIUS. Send request. Request ID [078] is sent"),
      line("C0001B7", ""),
      line("C0001B7", "-- RADIUS. Antifraud-Auth-Request [078] --"),
      line("C0001B7", "Password                         = ''"),
      line("C0001B7", `h323-conf-id                     = '${TAG_SPACED}'`),
      line("C0001B7", "Acct-Session-Id                  = '06000001 6ad34e68 3911cf0a 2430f5f0'"),
      line("C0001B7", "h323-call-origin                 = 'originate'"),
      line("C0001B7", "--------------------------------"),
      line("C0001B7", "Conn[0030]: Dest set [YES]. Time [21:16]"),
      ...rcBlock(2, 78),
      line("C0001B7", "Port SIPT:00da. RADIUS: Request ID [078] got valid reply for accs (in 27 ms)"),
      "<14> <smg1016m>  13:20:25.326000  [INFO] RADIUS. Reply queue. Processing Reply message",
      line("C0001B7", "RADIUS. Proc Reply. Request ID [078] process reply"),
      line("C0001B7", "RADIUS. Proc Reply. Request ID [078] Accs-Reply [accept]. Time [27:27]"),
      line("C0001B7", "Port SIPT:00da. RADIUS: process call. Accs req status: antifraud"),
      line("C0001B7", "Port SS7:00:01. Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 1, RREQ 5."),
      line("C0001B7", "Port SS7:00:01. RADIUS: Accs-Request [antifraud_out]"),
      line("C0001B7", "RADIUS. Request proc. Request ID[079]. Processing Antifraud-Auth-Request"),
      line("C0001B7", `RADIUS. Send request. Server[0]: 91.195.253.131:1812:${SECRET}`),
      line("C0001B7", "RADIUS. Send request. Request ID [079] is sent"),
      line("C0001B7", "-- RADIUS. Antifraud-Auth-Request [079] --"),
      line("C0001B7", "h323-call-origin                 = 'answer'"),
      line("C0001B7", "--------------------------------"),
      ...rcBlock(2, 79),
      line("C0001B7", "Port SS7:00:01. RADIUS: Request ID [079] got valid reply for accs (in 20 ms)"),
      "<14> <smg1016m>  13:20:25.326000  [INFO] RADIUS. Reply queue. Processing Reply message",
      line("C0001B7", "RADIUS. Proc Reply. Request ID [079] process reply"),
      line("C0001B7", "stage antifraud_out blocking behaviour is set."),
      line("C0001B7", "Request ID [079] Accs-Reply [accept]. Time [20:20]"),
      line("C0001B7", "Port SS7:00:01. RADIUS: process call. Accs req status: antifraud_out"),
      line("C0001B7", "Port SS7:00:01. Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 0, OS 0, RREQ 5."),
      line("C0001B7", "Port SS7:00:01. Accs-Request for Antifraud: no flags set - skip."),
      line("C0001B7", "RADIUS server rejected: :0 (replied 0)"),
    ].join("\n");
    const blocks = projectSpan(spansOf(text)[0]!);
    expect(blocks.mismatch).toBe(false);
    expect(blocks.text).toContain(SECRET);
    expect(blocks.text).toContain("Password                         = ''");
    expect(blocks.text).toContain("Reply queue");
    expect(blocks.text).toContain("in 27 ms");
    expect(blocks.text).toContain("in 20 ms");
    expect(blocks.text).toContain("no flags set - skip");
    expect(blocks.text).toContain("USE_AF 0");
    expect(blocks.text).not.toContain("ANTIFRAUD");
    expect(blocks.text).not.toContain("from-RADIUS-modify");
    expect(blocks.text).not.toContain("IAM-");
    expect(blocks.text).not.toContain("Conn[");
    expect(blocks.text).not.toContain("server rejected");
    expect(blocks.text).not.toContain("<14>");
    expect(blocks.text.split("\n").some((row) => row === "[C0001B7]")).toBe(true);
  });

  it("keeps an old-firmware ignore leg and does not steal another digest", () => {
    const text = [
      line("C02B7D1", `Port SIPT:00ee. Set UniqueTag: '${TAG}'`),
      line("C02B7D1", "Port SIPT:00ee. Accs-Request for Antifraud: check TG(i/o): 27(ext)/26(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: Accs-Request [antifraud]"),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: Request ID [081] process Antifraud-Auth-Request."),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: Request ID [081] send. Attempt: 1. Srv-grp [0]"),
      line("C02B7D1", "-- RADIUS. Antifraud-Auth-Request [081] --"),
      line("C02B7D1", "h323-call-origin                 = 'originate'"),
      line("C02B7D1", "--------------------------------"),
      ...rcBlock(2, 81),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: Request ID [081] got valid reply for accs (in 185 ms)"),
      "<14> <smg1016m>  10:30:19.720307  [INFO]  RADIUS: process queue",
      line("C02B7D1", "RADIUS: Request ID [081] process reply"),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: Request ID [081] Accs-Reply [accept]. Time [185:185]"),
      line("C02B7D1", "Port SIPT:00ee. RADIUS: process call. Accs req status: antifraud"),
      line("C02B7D1", "Port SIPT:07cc. Accs-Request for Antifraud: check TG(i/o): 27(ext)/26(ext), USE_AF 1, SD 0, OS 1, RREQ 5."),
      line("C02B7D1", "Port SIPT:07cc. RADIUS: Accs-Request [antifraud_out]"),
      line("C02B7D1", "Port SIPT:07cc. RADIUS: Request ID [085] process Antifraud-Auth-Request."),
      line("C02B7D1", "Port SIPT:07cc. RADIUS: Request ID [085] send. Attempt: 1. Srv-grp [0]"),
      line("C02B7D1", "-- RADIUS. Antifraud-Auth-Request [085] --"),
      line("C02B7D1", "h323-call-origin                 = 'answer'"),
      line("C02B7D1", "--------------------------------"),
      ...rcBlock(2, 85),
      line("C02B7D1", "Port SIPT:07cc. RADIUS: Request ID [085] got valid reply for accs (in 171 ms)"),
      "<14> <smg1016m>  10:30:19.895473  [INFO]  RADIUS: process queue",
      line("C02B7D1", "RADIUS: Request ID [085] process reply"),
      line("C02B7D1", "RADIUS: Request ID [085] process reply: ignore for not antifraud verify stage."),
      ...rcBlock(2, 73),
    ].join("\n");
    const blocks = projectSpan(spansOf(text)[0]!);
    expect(blocks.text).toContain("in 185 ms");
    expect(blocks.text).toContain("in 171 ms");
    expect(blocks.text).toContain("ignore for not antifraud");
    expect(blocks.text).toContain("process queue");
    expect(blocks.text).not.toContain("Accs-Reply   [085]");
    const own = packetHex(2, 85, [cisco("h323-credit-time=3600")]).slice(0, 16);
    const other = packetHex(2, 73, [cisco("h323-credit-time=3600")]).slice(0, 16);
    expect(blocks.text).toContain(own);
    expect(blocks.text).not.toContain(other);
  });

  it("keeps a reply that arrives in the next file on the same call", () => {
    const state = emptyTraceState();
    applyText(
      state,
      [
        line("C02A0E3", `Port SIPT:0001. Set UniqueTag: '${TAG_SPACED}'`),
        line("C02A0E3", "Port SIPT:0001. Accs-Request for Antifraud: check TG(i/o): 1(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
        line("C02A0E3", "Port SIPT:0001. RADIUS: Accs-Request [antifraud]"),
        line("C02A0E3", "RADIUS. Request proc. Request ID[196]. Processing Antifraud-Auth-Request"),
        line("C02A0E3", "RADIUS. Send request. Request ID [196] is sent"),
        line("C02A0E3", "-- RADIUS. Antifraud-Auth-Request [196] --"),
        line("C02A0E3", "Password                         = 'hunter2'"),
      ].join("\n"),
    );
    applyText(
      state,
      [
        line("C02A0E3", "h323-call-origin                 = 'originate'"),
        line("C02A0E3", "--------------------------------"),
        ...rcBlock(2, 196),
        line("C02A0E3", "Port SIPT:0001. RADIUS: Request ID [196] got valid reply for accs (in 12 ms)"),
        line("C02A0E3", "RADIUS. Proc Reply. Request ID [196] process reply"),
        line("C02A0E3", "Request ID [196] Accs-Reply [accept]"),
      ].join("\n"),
    );
    const blocks = projectSpan(Object.values(state.spans)[0]!);
    expect(blocks.text).toContain("hunter2");
    expect(blocks.text).toContain("Accs-Reply [accept]");
    expect(blocks.text).toContain(Buffer.from(SECRET, "latin1").toString("hex").toUpperCase());
  });

  it("does not glue a reused callref onto the previous text", () => {
    const next = "1100000000000000000000000000000b";
    const text = [
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`),
      line("C0000F6", `unique tag: '${TAG}'`),
      line("C0000F6", "Port SIPT:0001. Release time-stamp: 13:20:33.654 GMT Fri Oct 16 2026, msec-diff: 6328"),
      line("C0000F6", `Port SIPT:0002. Set UniqueTag: '${next}'`),
      line("C0000F6", "Port SIPT:0002. Set Antifraud RADIUS-profile [0] options."),
    ].join("\n");
    const spans = spansOf(text);
    const first = spans.find((span) => span.tag === TAG)!;
    const second = spans.find((span) => span.tag === next)!;
    expect(first.text).not.toContain("RADIUS-profile");
    expect(second.text).toContain("RADIUS-profile");
  });

  it("keeps an unrecognized prefix whole", () => {
    const blocks = projectSpan(
      spansOf(
        [
          line("C0000F6", `Set UniqueTag: '${TAG}'`),
          "NO PREFIX [C0000F6] Port SIPT:0001. Set Antifraud RADIUS-profile [1] options.",
        ].join("\n"),
      )[0]!,
    );
    expect(blocks.text).toContain("NO PREFIX");
  });

  it("drops an rc block when two calls share the request id", () => {
    const text = [
      line("C0000A1", `Set UniqueTag: '${TAG}'`),
      line("C0000A1", "Accs-Request for Antifraud: check TG(i/o): 1(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C0000A1", "RADIUS: Accs-Request [antifraud]"),
      line("C0000A1", "Request ID[010]. Processing Antifraud-Auth-Request"),
      line("C0000A1", "Request ID [010] is sent"),
      line("C0000B2", `Set UniqueTag: '${ANSWER}'`),
      line("C0000B2", "Accs-Request for Antifraud: check TG(i/o): 1(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
      line("C0000B2", "RADIUS: Accs-Request [antifraud]"),
      line("C0000B2", "Request ID[010]. Processing Antifraud-Auth-Request"),
      line("C0000B2", "Request ID [010] is sent"),
      ...rcBlock(2, 10),
      line("C0000A1", "Request ID [010] got valid reply for accs (in 5 ms)"),
    ].join("\n");
    const spans = spansOf(text);
    for (const span of spans) {
      expect(span.text).not.toContain("Calculating digest");
    }
    expect(spans.find((span) => span.tag === TAG)?.text).toContain("got valid reply");
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
      ended: false,
      releaseGeneration: null,
      startedKey: "",
      text: "",
      sawUniqueTag: true,
      sealed: false,
      attemptOpen: false,
      pendingBlank: null,
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
    expect(updated[0]?.sealed).toBe(false);
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
    expect(saved.at(-1)?.open).toBe(true);
    expect(spansOfMark(repo).C0000F6).toBeDefined();
    const eveningBytes = readFileSync(raw);
    unlinkSync(raw);
    writeFileSync(`${raw}.gz`, gzipSync(eveningBytes));
    await stepDevice("10.1.2.3", sources(), repo.repo);
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved.at(-1)?.open).toBe(true);
    expect(spansOfMark(repo).C0000F6).toBeDefined();
    const morningRaw = path.join(morning, "00.log");
    const morningBytes = readFileSync(morningRaw);
    unlinkSync(morningRaw);
    writeFileSync(`${morningRaw}.gz`, gzipSync(morningBytes));
    await stepDevice("10.1.2.3", sources(), repo.repo);
    writeFileSync(path.join(morning, "10.log"), "noise\n");
    await stepDevice("10.1.2.3", sources(), repo.repo);
    expect(saved.at(-1)?.open).toBe(false);
    expect(spansOfMark(repo).C0000F6).toBeUndefined();
  });

  it("does not apply a gzip whose prefix is not the raw that was read", async () => {
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
    unlinkSync(raw);
    writeFileSync(path.join(hour, "00.log.gz"), gzipSync(Buffer.from(prefix + extra)));
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG && row.open)).toBe(true);
  });

  it("does not read the next slot while the current raw log is still open", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    writeFileSync(path.join(hour, "00.log"), "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    writeFileSync(
      path.join(hour, "10.log"),
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n",
    );
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
  });

  it("does not save a release echo that never saw Set UniqueTag", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    writeFileSync(raw, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    appendFileSync(raw, line("C0000F6", `unique tag: '${TAG}'`) + "\n");
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
    appendFileSync(raw, line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n");
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(true);
  });

  it("waits for a torn raw line and keeps the tag once", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    writeFileSync(raw, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    const whole = line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n";
    appendFileSync(raw, whole.slice(0, 12));
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
    appendFileSync(raw, whole.slice(12));
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.filter((row) => row.tag === TAG)).toHaveLength(1);
  });

  it("feeds a frozen gzip line without a newline and then reads the next slot", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const raw = path.join(hour, "00.log");
    const prefix = "noise\n";
    writeFileSync(raw, prefix);
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    unlinkSync(raw);
    writeFileSync(
      path.join(hour, "00.log.gz"),
      gzipSync(Buffer.from(prefix + line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`))),
    );
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(saved.filter((row) => row.tag === TAG)).toHaveLength(1);
    writeFileSync(path.join(hour, "10.log"), "later\n");
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    const mark = repo.rows.get(LIVE_FILE_KEY)?.state as { floor?: string };
    expect(mark.floor).toBe("10.1.2.3/2026/10/16/08/10");
  });

  it("replays a gzip from the start of the file without repeating a line", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    const first = path.join(hour, "00.log");
    writeFileSync(first, "noise\n");
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    const sources = () => listTraceSources(root);
    await stepDevice("10.1.2.3", sources(), repo.repo);
    const firstBytes = readFileSync(first);
    unlinkSync(first);
    writeFileSync(`${first}.gz`, gzipSync(firstBytes));
    await stepDevice("10.1.2.3", sources(), repo.repo);
    const second = path.join(hour, "10.log");
    writeFileSync(second, "noise\n");
    await stepDevice("10.1.2.3", sources(), repo.repo);
    const call = [
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`),
      line("C0000F6", "Accs-Request for Antifraud: check TG(i/o): 5(ext)/0(ext), USE_AF 1, SD 1, OS 0, RREQ 4."),
    ].join("\n");
    appendFileSync(second, `${call}\n`);
    await stepDevice("10.1.2.3", sources(), repo.repo);
    const full = readFileSync(second);
    unlinkSync(second);
    writeFileSync(`${second}.gz`, gzipSync(full));
    await stepDevice("10.1.2.3", sources(), repo.repo);
    const span = spansOfMark(repo).C0000F6 as { text?: string };
    expect(span.text?.match(/Accs-Request for Antifraud/g)).toEqual(["Accs-Request for Antifraud"]);
  });

  it("does not seed again when the current mark cannot be read", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-trace-"));
    const hour = path.join(root, "10.1.2.3", "2026", "10", "16", "08");
    mkdirSync(hour, { recursive: true });
    writeFileSync(
      path.join(hour, "50.log"),
      line("C0000F6", `Port SIPT:0001. Set UniqueTag: '${TAG}'`) + "\n",
    );
    const saved: { tag: string; open: boolean }[] = [];
    const repo = memoryRepo(saved);
    repo.cards.add("keep");
    repo.rows.set(LIVE_FILE_KEY, {
      fileKey: LIVE_FILE_KEY,
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state: { broken: true },
    });
    await stepDevice("10.1.2.3", listTraceSources(root), repo.repo);
    expect(repo.cards.has("keep")).toBe(true);
    expect(saved.some((row) => row.tag === TAG)).toBe(false);
    expect(repo.rows.get(LIVE_FILE_KEY)?.state).toEqual({ broken: true });
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

  it("drops every card once when no current live mark exists, including a gateway with no directory", async () => {
    const cards = new Set(["orphan-gateway", "on-disk"]);
    const wiped = await forgetCardsIfUnmarked({
      async liveMarkVersions() {
        return [4];
      },
      async deleteAllCards() {
        cards.clear();
      },
    });
    expect(wiped).toBe(true);
    expect(cards.size).toBe(0);
  });

  it("keeps cards once a current live mark exists", async () => {
    const cards = new Set(["keep"]);
    const wiped = await forgetCardsIfUnmarked({
      async liveMarkVersions() {
        return [4, SMG_TRACE_PARSER_VERSION];
      },
      async deleteAllCards() {
        cards.clear();
      },
    });
    expect(wiped).toBe(false);
    expect(cards.has("keep")).toBe(true);
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
      saved.push({ tag: span.tag, open: !span.sealed });
    },
    async saveCheckpoint(_ip, fileKey, size, state) {
      rows.set(fileKey, { fileKey, size, version: SMG_TRACE_PARSER_VERSION, state });
    },
  };
  return { repo, rows, cards };
}
