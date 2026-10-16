import { parseRadiusPacket, radiusCodeLabel } from "@/modules/smg-trace/packet";
import { realTag, redactSecrets } from "@/modules/smg-trace/tag";
import type {
  TraceAttr,
  TraceBlocks,
  TraceLeg,
  TraceMedia,
  TraceSignalLeg,
} from "@/modules/smg-trace/types";

/** Bump to re-read every syslog file that is still on disk. */
export const SMG_TRACE_PARSER_VERSION = 2;

const NOTE_CAP = 40;
const STEP_CAP = 80;
const TIME_CAP = 24;
const MESSAGE_CAP = 24;

type Attempt = {
  side: string;
  requestId: string;
  requestType: string;
  origin: string;
  attempts: string;
  sessionId: string;
  profile: string;
  tg: string;
  reason: string;
  wait: string;
  server: string;
  numbers: string;
  useAf: string;
  attributes: TraceAttr[];
  reply: string;
  replyCode: string;
  replyAttributes: TraceAttr[];
  packetAttributes: TraceAttr[];
  replyTime: string;
  ignored: string;
  released: string;
  notes: string[];
};

export type TraceSpan = {
  callref: string;
  tag: string;
  mismatch: boolean;
  echoed: boolean;
  rejecting: string;
  party: "" | "calling" | "called";
  lastPort: string;
  /** Index of the file where `unique tag:` was seen. Null until that line. */
  echoGeneration: number | null;
  lead: string[];
  attempts: Attempt[];
  signal: TraceSignalLeg[];
  numbers: { port: string; text: string }[];
  times: { port: string; event: string; stamp: string; delta: string }[];
  media: TraceMedia[];
};

type Inflight = { id: number; callref: string; index: number };

type Collecting = { callref: string; index: number; kind: "request" | "reply" };

export type TraceState = {
  spans: Record<string, TraceSpan>;
  inflight: Inflight[];
  ambiguousIds: number[];
  collecting: Collecting | null;
  rcHex: string;
  rcActive: boolean;
  /** Callrefs changed by the file that is being read. Cleared when that file is committed. */
  dirty: string[];
};

export function emptyTraceState(): TraceState {
  return {
    spans: {},
    inflight: [],
    ambiguousIds: [],
    collecting: null,
    rcHex: "",
    rcActive: false,
    dirty: [],
  };
}

export function restoreTraceState(value: unknown): TraceState {
  const empty = emptyTraceState();
  if (!value || typeof value !== "object") return empty;
  const row = value as Partial<TraceState>;
  if (!row.spans || typeof row.spans !== "object") return empty;
  return {
    spans: row.spans,
    inflight: Array.isArray(row.inflight) ? row.inflight : [],
    ambiguousIds: Array.isArray(row.ambiguousIds) ? row.ambiguousIds : [],
    collecting: row.collecting ?? null,
    rcHex: typeof row.rcHex === "string" ? row.rcHex : "",
    rcActive: row.rcActive === true,
    dirty: [],
  };
}

/**
 * Write only the calls this file changed. A call whose CDR echo was already
 * kept through the previous file leaves the state. A call that has not echoed
 * stays, including its unanswered RADIUS id.
 */
export function commitTraceFile(state: TraceState, fileIndex: number): TraceSpan[] {
  const saved: TraceSpan[] = [];
  const seen = new Set<string>();
  for (const callref of state.dirty) {
    const span = state.spans[callref];
    if (!span?.tag || seen.has(span.tag)) continue;
    seen.add(span.tag);
    saved.push(span);
  }
  for (const span of Object.values(state.spans)) {
    if (span.echoed && span.echoGeneration == null) span.echoGeneration = fileIndex;
  }
  for (const [callref, span] of Object.entries(state.spans)) {
    if (span.echoGeneration == null || span.echoGeneration >= fileIndex) continue;
    delete state.spans[callref];
    state.inflight = state.inflight.filter((item) => item.callref !== callref);
    if (state.collecting?.callref === callref) state.collecting = null;
  }
  state.dirty = [];
  return saved;
}

/** Apply one syslog file. Returns spans that a newer tag replaced. */
export function applyText(state: TraceState, text: string): TraceSpan[] {
  const detached: TraceSpan[] = [];
  for (const line of text.split(/\n/)) {
    const gone = applyLine(state, line);
    if (gone?.tag) detached.push(gone);
  }
  return detached;
}

export function applyLine(state: TraceState, rawLine: string): TraceSpan | null {
  const line = redactSecrets(rawLine);
  if (!line.trim() || line.includes("<pa_sip>")) return null;
  if (/\bConn\[/.test(line) && !/IP </.test(line)) return null;
  if (/keep-alive|keepalive/i.test(line)) return null;
  if (/management disabled/i.test(line)) return null;
  if (/process queue|Reply queue/i.test(line)) return null;

  const payload = payloadOf(line);
  if (state.rcActive || /Calculating digest on/.test(payload)) {
    if (consumeRc(state, payload)) return null;
  }

  const callref = callrefOf(line);
  if (state.collecting && callref === state.collecting.callref) {
    if (/^-{6,}$/.test(payload)) {
      state.collecting = null;
      return null;
    }
    const attr = parseAttr(payload);
    if (attr) {
      pushCollected(state, attr);
      touch(state, callref);
      return null;
    }
    if (!payload) return null;
  }

  if (!callref) return null;
  const taken = takeSpan(state, callref, namingTag(payload));
  touch(state, callref);
  absorb(state, taken.span, payload);
  return taken.detached;
}

function touch(state: TraceState, callref: string): void {
  if (!state.dirty.includes(callref)) state.dirty.push(callref);
}

export function projectSpan(span: TraceSpan): TraceBlocks {
  const sent = span.attempts.some(
    (leg) =>
      leg.requestId !== "" ||
      leg.attributes.length > 0 ||
      leg.reply !== "" ||
      leg.replyCode !== "" ||
      leg.packetAttributes.length > 0,
  );
  const checkedOff = span.attempts.some((leg) => leg.useAf === "0");
  let summary = "В трассе нет обмена с Антифродом.";
  if (sent) summary = "Обмен RADIUS с Антифродом.";
  else if (checkedOff) {
    summary = "Шлюз проверил транк-группу и не отправил Access-Request (USE_AF 0).";
  } else if (span.attempts.length > 0) {
    summary = "Проверка Антифрода без отправленного запроса.";
  }

  return {
    antifraud: {
      summary,
      rejecting: span.rejecting,
      mismatch: span.mismatch,
      notes: span.lead,
      legs: span.attempts.map(presentLeg),
    },
    signal: span.signal.filter((leg) => leg.callId !== "" || leg.messages.length > 0),
    numbers: span.numbers,
    times: span.times,
    media: span.media.filter((leg) =>
      [leg.codec, leg.offer, leg.rtp, leg.dtmf, leg.fax, leg.vbd, leg.dscp].some(Boolean),
    ),
  };
}

function presentLeg(leg: Attempt): TraceLeg {
  const replyAttributes =
    leg.replyAttributes.length > 0 ? leg.replyAttributes : leg.packetAttributes;
  return {
    side: leg.side,
    requestId: leg.requestId,
    requestType: leg.requestType,
    origin: leg.origin,
    attempts: leg.attempts,
    sessionId: leg.sessionId,
    profile: leg.profile,
    tg: leg.tg,
    reason: leg.reason,
    wait: leg.wait,
    server: leg.server,
    numbers: leg.numbers,
    useAf: leg.useAf,
    attributes: leg.attributes,
    reply: leg.reply,
    replyCode: leg.replyCode,
    replyAttributes,
    replyTime: leg.replyTime,
    ignored: leg.ignored,
    released: leg.released,
    notes: leg.notes,
  };
}

function consumeRc(state: TraceState, payload: string): boolean {
  if (/Calculating digest on/.test(payload)) {
    state.rcActive = true;
    state.rcHex = "";
    return true;
  }
  if (!state.rcActive) return false;
  if (/Calculated digest/.test(payload)) {
    const parsed = parseRadiusPacket(state.rcHex);
    state.rcActive = false;
    state.rcHex = "";
    if (parsed) bindPacket(state, parsed);
    return true;
  }
  const hex = payload.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{8,}$/.test(hex)) {
    state.rcHex += hex;
    return true;
  }
  state.rcActive = false;
  state.rcHex = "";
  return false;
}

function bindPacket(state: TraceState, packet: { code: number; id: number; attributes: TraceAttr[] }): void {
  if (state.ambiguousIds.includes(packet.id)) {
    state.ambiguousIds = state.ambiguousIds.filter((id) => id !== packet.id);
    return;
  }
  const matches = state.inflight.filter((item) => item.id === packet.id);
  const callrefs = new Set(matches.map((item) => item.callref));
  if (matches.length !== 1 || callrefs.size !== 1) return;
  const hit = matches[0]!;
  const span = state.spans[hit.callref];
  const attempt = span?.attempts[hit.index];
  if (!span || !attempt) return;
  touch(state, hit.callref);
  attempt.replyCode = radiusCodeLabel(packet.code);
  attempt.packetAttributes = packet.attributes;
  state.inflight = state.inflight.filter((item) => item.id !== packet.id || item.callref !== hit.callref);
}

function payloadOf(line: string): string {
  const rc = line.match(/\brc:\s*(.*)$/);
  if (rc) return rc[1]?.trim() ?? "";
  const bracket = line.match(/\[(C[0-9A-Fa-f]{4,})\](.*)$/);
  if (bracket) return bracket[2]?.trim() ?? "";
  return line.trim();
}

function callrefOf(line: string): string | null {
  const match = line.match(/\[(C[0-9A-Fa-f]{4,})\]/);
  return match?.[1]?.toUpperCase() ?? null;
}

function namingTag(payload: string): string | null {
  const set = payload.match(/Set UniqueTag:\s*'([^']*)'/);
  if (set?.[1] != null) return realTag(set[1]);
  const session = payload.match(/session-ID\s*\[([^\]]*)\]/);
  if (session?.[1] != null) return realTag(session[1]);
  return null;
}

function takeSpan(
  state: TraceState,
  callref: string,
  naming: string | null,
): { span: TraceSpan; detached: TraceSpan | null } {
  const current = state.spans[callref];
  if (naming && current?.tag && current.tag !== naming && !current.echoed) {
    current.mismatch = true;
    return { span: current, detached: null };
  }
  if (naming && current?.tag && current.tag !== naming) {
    delete state.spans[callref];
    state.inflight = state.inflight.filter((item) => item.callref !== callref);
    if (state.collecting?.callref === callref) state.collecting = null;
    const span = createSpan(callref);
    span.tag = naming;
    state.spans[callref] = span;
    return { span, detached: current };
  }
  if (!current) {
    const span = createSpan(callref);
    if (naming) span.tag = naming;
    state.spans[callref] = span;
    return { span, detached: null };
  }
  if (naming && !current.tag) current.tag = naming;
  return { span: current, detached: null };
}

function absorb(state: TraceState, span: TraceSpan, payload: string): void {
  if (!payload) return;
  const seenPort = portOf(payload);
  if (seenPort) span.lastPort = seenPort;
  markEcho(span, payload);
  absorbSignal(span, payload);
  absorbNumbers(span, payload);
  absorbTimes(span, payload);
  absorbMedia(span, payload);
  absorbAntifraud(state, span, payload);
}

function markEcho(span: TraceSpan, payload: string): void {
  if (!/unique tag\s*:/i.test(payload)) return;
  span.echoed = true;
  const quoted = payload.match(/unique tag:\s*'([^']*)'/i);
  const tag = quoted?.[1] != null ? realTag(quoted[1]) : null;
  if (tag && !span.tag) span.tag = tag;
  else if (tag && span.tag !== tag) span.mismatch = true;
}

function absorbSignal(span: TraceSpan, payload: string): void {
  const port = portOf(payload) || span.lastPort;
  const message = payload.match(/\b(IAM|ACM|ANM|REL|RLC|CPG|CON)-/);
  if (message?.[1]) pushMessage(span, port || "SS7", message[1]);
  if (/\bSIP\b/.test(payload)) {
    const sip = payload.match(/\b(INVITE|BYE|ACK|CANCEL|PRACK|UPDATE)\b/);
    if (sip?.[1]) pushMessage(span, port || "SIP", sip[1]);
  }
  const callId =
    payload.match(/Call-ID\s*<([^>]+)>/) ?? payload.match(/Call-ID:\s*'([^']+)'/);
  if (callId?.[1]) {
    const leg = ensureSignal(span, port || "SIP");
    leg.callId = callId[1];
  }
}

function absorbNumbers(span: TraceSpan, payload: string): void {
  const port = portOf(payload) || span.lastPort;
  if (/Calling party number:/.test(payload)) {
    span.party = "calling";
    return;
  }
  if (/Called party number:/.test(payload)) {
    span.party = "called";
    return;
  }
  const printed = payload.match(/#\s*Number:\s*([0-9*#]+)/);
  if (printed?.[1] && span.party) {
    pushStep(span, port, `${span.party === "calling" ? "CgPN" : "CdPN"} ${printed[1]}`);
    return;
  }
  const mask = payload.match(/number mask <([^>]+)>/);
  if (mask?.[1]) {
    pushStep(span, port, `маска ${mask[1]}`);
    return;
  }
  const rule = payload.match(/rule <([^>]+)>/);
  if (rule?.[1]) {
    pushStep(span, port, `правило ${rule[1]}`);
    return;
  }
  const result = payload.match(/result-num:\s*<([^>]+)>/);
  if (result?.[1]) {
    pushStep(span, port, `после ${result[1]}`);
    return;
  }
  const cg = payload.match(/CgPN:\s*<([^>]+)>/);
  if (cg?.[1]) {
    pushStep(span, port, `CgPN ${cg[1]}`);
    return;
  }
  const cd = payload.match(/CdPN:\s*<([^>]+)>/);
  if (cd?.[1]) {
    pushStep(span, port, `CdPN ${cd[1]}`);
    return;
  }
  if (/params:/.test(payload)) {
    const plan = payload.match(/numplan <([^>]+)>/);
    const pres = payload.match(/pres <([^>]+)>/);
    if (plan?.[1]) pushStep(span, port, `план ${plan[1]}`);
    if (pres?.[1]) pushStep(span, port, `presentation ${pres[1]}`);
    return;
  }
  const prefix = payload.match(/Prefix\s+(\d+):\s*type '([^']+)'/);
  if (prefix?.[1] && prefix[2]) {
    pushStep(span, port, `префикс ${prefix[1]} ${prefix[2]}`);
    return;
  }
  const trunk = payload.match(/Link to TG\s+(\S+)/);
  if (trunk?.[1]) {
    pushStep(span, port, `транк-группа ${trunk[1].replace(/\.$/, "")}`);
    return;
  }
  if (/enblock/i.test(payload)) {
    pushStep(span, port, "enblock");
    return;
  }
  const table = payload.match(/ModTable[^[]*\[([^\]]+)\]/);
  if (table?.[1]) pushStep(span, port, `ModTable ${table[1]}`);
}

function absorbTimes(span: TraceSpan, payload: string): void {
  const match = payload.match(
    /(Setup|Answer|Release)\s+time-stamp:\s*(.+?)(?:,\s*msec-diff:\s*(\d+))?\s*$/,
  );
  if (!match?.[1] || !match[2]) return;
  const row = {
    port: portOf(payload) || span.lastPort,
    event: match[1],
    stamp: match[2].trim(),
    delta: match[3] ? `${match[3]} ms` : "",
  };
  const last = span.times[span.times.length - 1];
  if (last && last.port === row.port && last.event === row.event && last.stamp === row.stamp) return;
  if (span.times.length < TIME_CAP) span.times.push(row);
}

function absorbMedia(span: TraceSpan, payload: string): void {
  const port = portOf(payload) || span.lastPort;
  const codec = payload.match(/Use codec:\s*(\S+)\s+(\S+)\.\s*PT\s*(\d+),\s*PTE\s*(\d+)/);
  if (codec?.[1] && codec[2] && codec[3] && codec[4]) {
    const media = ensureMedia(span, port);
    media.codec = codec[1];
    media.direction = codec[2];
    media.payload = codec[3];
    media.ptime = codec[4];
  }
  const offer = payload.match(/m\[\d+\]:\s*(.+)$/);
  if (offer?.[1]) ensureMedia(span, port).offer = offer[1].trim();
  const dtmf = payload.match(/dtmf_mode '([^']+)'/);
  if (dtmf?.[1]) ensureMedia(span, port).dtmf = dtmf[1];
  const fax = payload.match(/fax_mode '([^']+)'/);
  if (fax?.[1]) ensureMedia(span, port).fax = fax[1];
  const vbd = payload.match(/use_vbd '([^']+)'/);
  if (vbd?.[1]) ensureMedia(span, port).vbd = vbd[1];
  const dscp = payload.match(/dscp \[(\d+)\]/);
  if (dscp?.[1]) ensureMedia(span, port).dscp = dscp[1];
  const rtp = payload.match(/\bIP <([^>]+)>/);
  if (rtp?.[1]) ensureMedia(span, port).rtp = rtp[1];
}

function absorbAntifraud(state: TraceState, span: TraceSpan, payload: string): void {
  const rejected = payload.match(/RADIUS server rejected:\s*(\S+)/);
  if (rejected?.[1]) span.rejecting = rejected[1];

  const dump = payload.match(/^--\s*RADIUS\..*\[(\d+)\]\s*--$/);
  if (dump?.[1]) {
    const id = Number(dump[1]);
    const kind = /Reply/i.test(payload) ? "reply" : "request";
    const index = ensureAttemptIndex(span, id, dump[1]);
    state.collecting = { callref: span.callref, index, kind };
    return;
  }

  const check = payload.match(
    /Accs-Request for Antifraud:\s*check TG\(i\/o\):\s*([^,]+),\s*USE_AF\s+(\d+),\s*SD\s+(\d+),\s*OS\s+(\d+),\s*RREQ\s+(\d+)/,
  );
  if (check?.[1] && check[2] && check[3] && check[4] && check[5]) {
    const side = check[4] === "1" ? "out" : check[3] === "1" ? "in" : "";
    const tg = `${check[1].trim()}, RREQ ${check[5]}`;
    const last = span.attempts[span.attempts.length - 1];
    if (last && !last.requestId && last.useAf === check[2] && last.tg === tg && last.side === side) {
      return;
    }
    const attempt =
      last && !last.requestId && !last.useAf ? last : pushAttempt(span);
    attempt.useAf = check[2];
    attempt.tg = tg;
    if (side) attempt.side = side;
    return;
  }

  const legKind = payload.match(/Accs-Request \[(antifraud(?:_out)?)\]/);
  if (legKind?.[1]) {
    const side = legKind[1] === "antifraud_out" ? "out" : "in";
    const last = span.attempts[span.attempts.length - 1];
    const attempt =
      !last || (last.side !== "" && last.side !== side && (last.requestId !== "" || last.useAf !== ""))
        ? pushAttempt(span)
        : last;
    if (!attempt.side) attempt.side = side;
    return;
  }

  const request = payload.match(/Request ID\s*\[(\d+)\]/);
  if (request?.[1] && /Request ID/.test(payload)) {
    assignRequest(state, span, request[1]);
  }

  const attempt = span.attempts[span.attempts.length - 1];
  if (!attempt) {
    if (/wait(?:\s+for)? Antifraud RADIUS-reply/i.test(payload)) {
      pushAttempt(span).wait = clip(payload);
      return;
    }
    if (/Antifraud|RADIUS/i.test(payload)) pushLead(span, payload);
    return;
  }

  const server = payload.match(/Server\[\d+\]:\s*(\d{1,3}(?:\.\d{1,3}){3}:\d+)/);
  if (server?.[1]) attempt.server = server[1];

  const count = payload.match(/Attempt:?\s*(\d+)\s+of\s+(\d+)/i);
  if (count?.[1] && count[2]) attempt.attempts = `${count[1]} of ${count[2]}`;

  const profile = payload.match(/profile idx (\d+),\s*group (\d+)/);
  if (profile?.[1] && profile[2]) attempt.profile = `idx ${profile[1]}, group ${profile[2]}`;

  const numbers = payload.match(/clg <([^>]*)>,\s*cld <([^>]*)>/);
  if (numbers) attempt.numbers = `clg ${numbers[1]}, cld ${numbers[2]}`;

  if (/wait(?:\s+for)? Antifraud RADIUS-reply/i.test(payload)) attempt.wait = clip(payload);

  if (/modified for transit/i.test(payload)) attempt.reason = clip(payload);

  const reply = payload.match(/Accs-Reply \[([^\]]+)\]/);
  if (reply?.[1]) attempt.reply = reply[1];
  const printedTime = payload.match(/Time \[(\d+:\d+)\]/);
  if (printedTime?.[1]) attempt.replyTime = printedTime[1];
  const got = payload.match(/got valid reply.*\(in (\d+) ms\)/);
  if (got?.[1] && !attempt.replyTime) attempt.replyTime = `${got[1]} ms`;
  if (/ignore for not antifraud/i.test(payload)) attempt.ignored = clip(payload);

  if (
    !/server rejected/i.test(payload) &&
    /Call rejected|release call|RADIUS reject|0x0015/i.test(payload)
  ) {
    attempt.released = clip(payload);
  }

  if (request?.[1] && (/got valid reply/i.test(payload) || reply)) {
    const id = Number(request[1]);
    state.inflight = state.inflight.filter(
      (item) => item.id !== id || item.callref !== span.callref,
    );
  }

  if (/Set Antifraud RADIUS-profile|from-RADIUS-modify|process modifiers|Prepare Antifraud|process call\./i.test(payload)) {
    pushNote(attempt, clip(payload));
  }
}

function assignRequest(state: TraceState, span: TraceSpan, printed: string): void {
  const id = Number(printed);
  let attempt = span.attempts[span.attempts.length - 1];
  if (
    attempt &&
    attempt.requestId !== "" &&
    Number(attempt.requestId) !== id &&
    (attempt.reply !== "" || attempt.replyCode !== "" || attempt.attributes.length > 0)
  ) {
    attempt = pushAttempt(span);
  } else if (!attempt) {
    attempt = pushAttempt(span);
  }
  if (!attempt.requestId) attempt.requestId = printed;
  const others = state.inflight.filter((item) => item.id === id && item.callref !== span.callref);
  state.inflight = state.inflight.filter((item) => item.id !== id);
  if (others.length > 0) {
    if (!state.ambiguousIds.includes(id)) state.ambiguousIds.push(id);
    return;
  }
  if (state.ambiguousIds.includes(id)) return;
  state.inflight.push({ id, callref: span.callref, index: span.attempts.length - 1 });
}

function ensureAttemptIndex(span: TraceSpan, id: number, printed: string): number {
  const found = span.attempts.findIndex((leg) => leg.requestId !== "" && Number(leg.requestId) === id);
  if (found >= 0) return found;
  const last = span.attempts[span.attempts.length - 1];
  if (last && !last.requestId) {
    last.requestId = printed;
    return span.attempts.length - 1;
  }
  const created = pushAttempt(span);
  created.requestId = printed;
  return span.attempts.length - 1;
}

function pushCollected(state: TraceState, attr: TraceAttr): void {
  const collecting = state.collecting;
  if (!collecting) return;
  const span = state.spans[collecting.callref];
  const attempt = span?.attempts[collecting.index];
  if (!span || !attempt) return;
  if (collecting.kind === "request") attempt.attributes.push(attr);
  else attempt.replyAttributes.push(attr);
  if (attr.name === "h323-conf-id") {
    const tag = realTag(attr.value);
    if (tag && !span.tag) span.tag = tag;
    else if (tag && span.tag !== tag) span.mismatch = true;
  }
  if (attr.name === "Acct-Session-Id" && !attempt.sessionId) attempt.sessionId = attr.value;
  if (attr.name === "h323-call-origin") {
    attempt.origin = attr.value;
    if (!attempt.side && attr.value === "originate") attempt.side = "in";
    if (!attempt.side && attr.value === "answer") attempt.side = "out";
  }
  if (attr.name === "Cisco-AVPair" && attr.value.startsWith("xpgk-request-type=")) {
    attempt.requestType = attr.value.slice("xpgk-request-type=".length);
  }
  if (attr.name === "Reply-Message" && !attempt.reply) attempt.reply = attr.value;
}

function parseAttr(payload: string): TraceAttr | null {
  const match = payload.match(/^([A-Za-z][A-Za-z0-9-]*)\s+=\s+'(.*)'$/);
  if (!match?.[1] || match[2] == null) return null;
  if (/password/i.test(match[1])) {
    return { name: "Password", value: match[2].trim() === "" ? "пусто" : "задано" };
  }
  return { name: match[1], value: match[2] };
}

function createSpan(callref: string): TraceSpan {
  return {
    callref,
    tag: "",
    mismatch: false,
    echoed: false,
    rejecting: "",
    party: "",
    lastPort: "",
    echoGeneration: null,
    lead: [],
    attempts: [],
    signal: [],
    numbers: [],
    times: [],
    media: [],
  };
}

function emptyAttempt(): Attempt {
  return {
    side: "",
    requestId: "",
    requestType: "",
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
    packetAttributes: [],
    replyTime: "",
    ignored: "",
    released: "",
    notes: [],
  };
}

function pushAttempt(span: TraceSpan): Attempt {
  const attempt = emptyAttempt();
  attempt.notes = span.lead;
  span.lead = [];
  span.attempts.push(attempt);
  return attempt;
}

function pushLead(span: TraceSpan, payload: string): void {
  pushUnique(span.lead, clip(payload), NOTE_CAP);
}

function pushNote(attempt: Attempt, text: string): void {
  pushUnique(attempt.notes, text, NOTE_CAP);
}

function pushUnique(list: string[], text: string, cap: number): void {
  if (!text || list[list.length - 1] === text || list.length >= cap) return;
  list.push(text);
}

function pushStep(span: TraceSpan, port: string, text: string): void {
  const last = span.numbers[span.numbers.length - 1];
  if (last && last.port === port && last.text === text) return;
  if (span.numbers.length < STEP_CAP) span.numbers.push({ port, text });
}

function pushMessage(span: TraceSpan, port: string, message: string): void {
  const leg = ensureSignal(span, port);
  if (leg.messages[leg.messages.length - 1] === message) return;
  if (leg.messages.length < MESSAGE_CAP) leg.messages.push(message);
}

function ensureSignal(span: TraceSpan, port: string): TraceSignalLeg {
  const found = span.signal.find((leg) => leg.port === port);
  if (found) return found;
  const created: TraceSignalLeg = { port, callId: "", messages: [] };
  span.signal.push(created);
  return created;
}

function ensureMedia(span: TraceSpan, port: string): TraceMedia {
  const found = span.media.find((leg) => leg.port === port);
  if (found) return found;
  const created: TraceMedia = {
    port,
    codec: "",
    payload: "",
    ptime: "",
    direction: "",
    offer: "",
    rtp: "",
    dtmf: "",
    fax: "",
    vbd: "",
    dscp: "",
  };
  span.media.push(created);
  return created;
}

function portOf(payload: string): string {
  const match = payload.match(/Port (SS7:\d+:\d+|SIPT:[0-9A-Fa-f]+)/);
  if (match?.[1]) return match[1];
  const sip = payload.match(/SIP\. Callref ([0-9A-Fa-f]+)/);
  if (sip?.[1]) return `SIPT:${sip[1]}`;
  return "";
}

function clip(payload: string): string {
  const text = payload.replace(/\s+/g, " ").trim();
  return text.length > 220 ? text.slice(0, 220) : text;
}
