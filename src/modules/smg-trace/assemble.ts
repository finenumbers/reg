import { parseRadiusPacket } from "@/modules/smg-trace/packet";
import { realTag } from "@/modules/smg-trace/tag";
import type { TraceBlocks } from "@/modules/smg-trace/types";

/**
 * Version 9 drops every stored card once, when no live mark of this version
 * exists yet. A foreign mark deletes checkpoints and is not read. The pass
 * then continues from the end of the open file. Older archives are not read.
 * The Parking journal is cleared once by a separate flag, not by this version.
 */
export const SMG_TRACE_PARSER_VERSION = 9;

/** A call with no release and no reject leaves the assembler after this long. */
export const SMG_TRACE_HOLD_MS = 4 * 60 * 60 * 1000;

const SYSLOG_PREFIX = /^<\d+>\s+<[^>]+>\s+\d{2}:\d{2}:\d{2}\.\d+\s+\[[A-Z]{3,4} ?\]\s*/;

export type TraceSpan = {
  callref: string;
  tag: string;
  mismatch: boolean;
  echoed: boolean;
  /** `Release time-stamp` or `Call rejected` has been seen. */
  ended: boolean;
  /** Slot index of the file that ended the call. Null until that commit. */
  releaseGeneration: number | null;
  /** File key of the slot where this call was first committed. */
  startedKey: string;
  /** Raw AntiFraud lines, syslog prefix removed, in read order. */
  text: string;
  /** The bytes included `Set UniqueTag`. A release echo alone does not open a card. */
  sawUniqueTag: boolean;
  /** Set when this commit removes the span. Until then the card stays open. */
  sealed: boolean;
  attemptOpen: boolean;
  pendingBlank: string | null;
};

type Inflight = { id: number; callref: string };

type Collecting = { callref: string };

export type TraceState = {
  spans: Record<string, TraceSpan>;
  inflight: Inflight[];
  ambiguousIds: number[];
  collecting: Collecting | null;
  rcHex: string;
  rcActive: boolean;
  rcLines: string[];
  rcStage: "body" | "calc" | "reply";
  heldQueue: string | null;
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
    rcLines: [],
    rcStage: "body",
    heldQueue: null,
    dirty: [],
  };
}

export function cloneTraceState(state: TraceState): TraceState {
  return restoreTraceState(structuredClone(state));
}

export function restoreTraceState(value: unknown): TraceState {
  const empty = emptyTraceState();
  if (!value || typeof value !== "object") return empty;
  const row = value as Partial<TraceState>;
  if (!row.spans || typeof row.spans !== "object") return empty;
  const spans: Record<string, TraceSpan> = {};
  for (const [key, span] of Object.entries(
    row.spans as Record<string, Partial<TraceSpan>>,
  )) {
    if (!span || typeof span !== "object") continue;
    spans[key] = {
      ...createSpan(typeof span.callref === "string" ? span.callref : key),
      ...span,
      text: typeof span.text === "string" ? span.text : "",
      sawUniqueTag: span.sawUniqueTag === true,
      sealed: span.sealed === true,
      attemptOpen: span.attemptOpen === true,
      pendingBlank: typeof span.pendingBlank === "string" ? span.pendingBlank : null,
    };
  }
  return {
    spans,
    inflight: Array.isArray(row.inflight) ? row.inflight : [],
    ambiguousIds: Array.isArray(row.ambiguousIds) ? row.ambiguousIds : [],
    collecting: row.collecting ?? null,
    rcHex: typeof row.rcHex === "string" ? row.rcHex : "",
    rcActive: row.rcActive === true,
    rcLines: Array.isArray(row.rcLines)
      ? row.rcLines.filter((line) => typeof line === "string")
      : [],
    rcStage: row.rcStage === "calc" || row.rcStage === "reply" ? row.rcStage : "body",
    heldQueue: typeof row.heldQueue === "string" ? row.heldQueue : null,
    dirty: [],
  };
}

/**
 * Write the calls this slot changed. A call stays until `Release time-stamp`
 * or `Call rejected`, and through the next slot. `sealed` is set only on the
 * commit that drops the span. The column can already name a finished exchange.
 */
export function commitTraceFile(
  state: TraceState,
  fileIndex: number,
  fileKey = "",
): TraceSpan[] {
  const now = fileKey ? slotInstant(fileKey) : null;
  for (const span of Object.values(state.spans)) {
    if (!span.startedKey && fileKey) span.startedKey = fileKey;
    if (span.ended && span.releaseGeneration == null) span.releaseGeneration = fileIndex;
  }
  for (const span of Object.values(state.spans)) {
    const born = span.startedKey ? slotInstant(span.startedKey) : null;
    const expired = now != null && born != null && now - born >= SMG_TRACE_HOLD_MS;
    const finished = span.releaseGeneration != null && span.releaseGeneration < fileIndex;
    if (finished || expired) span.sealed = true;
  }

  const saved: TraceSpan[] = [];
  const seen = new Set<string>();
  for (const callref of state.dirty) {
    const span = state.spans[callref];
    if (!span?.tag || seen.has(span.tag)) continue;
    seen.add(span.tag);
    saved.push(span);
  }
  for (const [callref, span] of Object.entries(state.spans)) {
    if (!span.sealed) continue;
    if (span.tag && !seen.has(span.tag)) {
      seen.add(span.tag);
      saved.push(span);
    }
    delete state.spans[callref];
    state.inflight = state.inflight.filter((item) => item.callref !== callref);
    if (state.collecting?.callref === callref) state.collecting = null;
  }
  state.dirty = [];
  return saved;
}

/** UTC instant of a `ip/year/month/day/hour/slot` key. The slot is the minute. */
export function slotInstant(fileKey: string): number | null {
  const parts = fileKey.split("/");
  if (parts.length < 6) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  return Date.UTC(year, month - 1, day, hour, minute);
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
  if (!rawLine.trim() || rawLine.includes("<pa_sip>")) return null;
  if (/keep-alive|keepalive/i.test(rawLine)) return null;
  if (/management disabled/i.test(rawLine)) return null;

  const stripped = stripPrefix(rawLine);
  const payload = payloadOf(stripped);

  if (state.rcActive || /Calculating digest on/i.test(payload)) {
    if (consumeRc(state, stripped, payload)) return null;
  }

  if (isQueueLine(payload) && !callrefOf(stripped)) {
    state.heldQueue = stripped;
    return null;
  }

  const callref = callrefOf(stripped);
  if (!callref) {
    state.heldQueue = null;
    return null;
  }

  if (state.collecting && state.collecting.callref !== callref) state.collecting = null;

  const taken = takeSpan(state, callref, namingTag(payload));
  const span = taken.span;
  if (/Set UniqueTag:/i.test(payload)) span.sawUniqueTag = true;
  touch(state, callref);
  markEcho(span, payload);
  markEnd(span, payload);
  noteIdentity(span, payload);
  noteInflight(state, span, payload);
  flushBlank(span, payload);

  if (state.heldQueue) {
    if (queueBelongs(span, payload)) appendLine(span, state.heldQueue);
    state.heldQueue = null;
  }

  if (!payload) {
    if (state.collecting?.callref === callref) appendLine(span, stripped);
    else span.pendingBlank = stripped;
    return taken.detached;
  }

  const inDump = state.collecting?.callref === callref;
  openWindow(span, payload);
  if (shouldStore(payload, span, inDump)) {
    appendLine(span, stripped);
    closeWindow(span, payload);
    updateDump(state, span, payload);
  }
  return taken.detached;
}

export function projectSpan(span: TraceSpan): TraceBlocks {
  return { text: span.text, mismatch: span.mismatch, startedKey: span.startedKey };
}

/** A SIP «Call rejected» or an empty `RADIUS server rejected: :0` is not this. */
export function radiusReleaseLine(payload: string): boolean {
  if (/server rejected/i.test(payload)) return false;
  return (
    /RADIUS:\s*release call/i.test(payload) ||
    /RADIUS reject/i.test(payload) ||
    /0x0015/i.test(payload)
  );
}

function stripPrefix(line: string): string {
  if (!SYSLOG_PREFIX.test(line)) return line.trimEnd();
  return line.replace(SYSLOG_PREFIX, "").trimEnd();
}

function consumeRc(state: TraceState, stripped: string, payload: string): boolean {
  if (/Calculating digest on/i.test(payload)) {
    state.rcActive = true;
    state.rcHex = "";
    state.rcLines = [stripped];
    state.rcStage = "body";
    return true;
  }
  if (!state.rcActive) return false;
  if (state.rcStage === "body" && /Calculated digest/i.test(payload)) {
    state.rcLines.push(stripped);
    state.rcStage = "calc";
    return true;
  }
  if (state.rcStage === "calc" && /Reply digest/i.test(payload)) {
    state.rcLines.push(stripped);
    state.rcStage = "reply";
    return true;
  }
  const hex = payload.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{8,}$/.test(hex)) {
    state.rcLines.push(stripped);
    if (state.rcStage === "body") state.rcHex += hex;
    if (state.rcStage === "reply") finishRc(state);
    return true;
  }
  state.rcActive = false;
  state.rcHex = "";
  state.rcLines = [];
  state.rcStage = "body";
  return false;
}

function finishRc(state: TraceState): void {
  const lines = state.rcLines;
  const hex = state.rcHex;
  state.rcActive = false;
  state.rcHex = "";
  state.rcLines = [];
  state.rcStage = "body";
  const parsed = parseRadiusPacket(hex);
  if (!parsed) return;
  if (state.ambiguousIds.includes(parsed.id)) {
    state.ambiguousIds = state.ambiguousIds.filter((id) => id !== parsed.id);
    return;
  }
  const matches = state.inflight.filter((item) => item.id === parsed.id);
  const callrefs = new Set(matches.map((item) => item.callref));
  if (matches.length !== 1 || callrefs.size !== 1) return;
  const span = state.spans[matches[0]!.callref];
  if (!span) return;
  touch(state, span.callref);
  for (const line of lines) appendLine(span, line);
}

function queueBelongs(span: TraceSpan, payload: string): boolean {
  if (!/process reply/i.test(payload)) return false;
  const id = requestIdOf(payload);
  if (id == null) return false;
  const last = span.text.split("\n").at(-1) ?? "";
  return /got valid reply/i.test(last) && requestIdOf(last) === id;
}

function flushBlank(span: TraceSpan, payload: string): void {
  if (!span.pendingBlank) return;
  if (/^--\s*RADIUS\./i.test(payload) || /^-{6,}$/.test(payload))
    appendLine(span, span.pendingBlank);
  span.pendingBlank = null;
}

function shouldStore(payload: string, span: TraceSpan, inDump: boolean): boolean {
  if (excluded(payload)) return false;
  if (inDump) return true;
  if (isRadiusProfile(payload) || isOutSeize(payload)) return true;
  if (radiusReleaseLine(payload)) return true;
  if (!span.attemptOpen) return false;
  if (exchangeLine(payload) || /\bRADIUS\b/i.test(payload)) return true;
  return false;
}

/** Ordinary SMG profile. The license line `Set Antifraud RADIUS-profile` is not this. */
function isRadiusProfile(payload: string): boolean {
  return /Set RADIUS-profile\b/i.test(payload);
}

function isOutSeize(payload: string): boolean {
  return /Accs-Request \[out-seize\]/i.test(payload);
}

function excluded(payload: string): boolean {
  if (/Seize on version/i.test(payload)) return true;
  if (/seize-time/i.test(payload)) return true;
  if (/session-ID\s*\[/i.test(payload)) return true;
  if (/RADIUS\s*=\s*-1/i.test(payload)) return true;
  if (/from-RADIUS-modify/i.test(payload)) return true;
  if (/\bConn\[/.test(payload)) return true;
  if (/server rejected/i.test(payload)) return true;
  if (/process modifiers/i.test(payload)) return true;
  if (/Accounting-Request|Acct-Request/i.test(payload)) return true;
  if (/\b(IAM|ACM|ANM|REL|RLC|CPG|CON)-/.test(payload)) return true;
  if (/\bDial\b/i.test(payload) && !/Antifraud/i.test(payload)) return true;
  if (
    /Modify at|Number tranzit|ModTable\b|Prefix linked|CheckRTP|rtp-cfg|fax_mode/i.test(
      payload,
    )
  ) {
    return true;
  }
  return false;
}

function exchangeLine(payload: string): boolean {
  return (
    /modified for transit/i.test(payload) ||
    /Accs-Request \[/i.test(payload) ||
    /Prepare Authorization-Request|Prepare Antifraud/i.test(payload) ||
    /profile idx/i.test(payload) ||
    /clg\s*</i.test(payload) ||
    /Request ID/i.test(payload) ||
    /Attempt:?\s*\d+/i.test(payload) ||
    /Srv-grp|Server\[\d+\]/i.test(payload) ||
    /\bis sent\b/i.test(payload) ||
    /^--\s*RADIUS\./i.test(payload) ||
    /^-{6,}$/.test(payload) ||
    /blocking behaviour/i.test(payload) ||
    /got valid reply/i.test(payload) ||
    /process reply/i.test(payload) ||
    /Accs-Reply/i.test(payload) ||
    /ignore for not antifraud/i.test(payload) ||
    /process call\./i.test(payload)
  );
}

function openWindow(span: TraceSpan, payload: string): void {
  if (
    isRadiusProfile(payload) ||
    isOutSeize(payload) ||
    /Processing Accs-Request|process Accs-Request/i.test(payload)
  ) {
    span.attemptOpen = true;
  }
}

function closeWindow(span: TraceSpan, payload: string): void {
  if (/process call\.\s*Accs req status:/i.test(payload)) span.attemptOpen = false;
}

function updateDump(state: TraceState, span: TraceSpan, payload: string): void {
  if (/^--\s*RADIUS\./i.test(payload)) {
    state.collecting = { callref: span.callref };
    return;
  }
  if (/^-{6,}$/.test(payload) && state.collecting?.callref === span.callref) {
    state.collecting = null;
  }
}

function noteIdentity(span: TraceSpan, payload: string): void {
  const h323 = payload.match(/h323-conf-id\s*=\s*'([^']*)'/i);
  if (!h323?.[1]) return;
  const tag = realTag(h323[1]);
  if (!tag) return;
  if (!span.tag) span.tag = tag;
  else if (span.tag !== tag) span.mismatch = true;
}

function noteInflight(state: TraceState, span: TraceSpan, payload: string): void {
  const id = requestIdOf(payload);
  if (id == null) return;
  if (/Accounting-Request|Acct-Request/i.test(payload)) return;
  const sent = /Request ID\s*\[\d+\]\s+(?:is sent|send)\b/i.test(payload);
  const claim = sent || /Processing Accs-Request|process Accs-Request/i.test(payload);
  if (claim) {
    if (state.ambiguousIds.includes(id)) return;
    const others = state.inflight.some(
      (item) => item.id === id && item.callref !== span.callref,
    );
    if (others) {
      if (!state.ambiguousIds.includes(id)) state.ambiguousIds.push(id);
      state.inflight = state.inflight.filter((item) => item.id !== id);
      return;
    }
    if (sent) {
      state.inflight = state.inflight.filter(
        (item) => item.callref !== span.callref || item.id === id,
      );
    }
    if (!state.inflight.some((item) => item.id === id && item.callref === span.callref)) {
      state.inflight.push({ id, callref: span.callref });
    }
  }
  if (/got valid reply/i.test(payload)) {
    state.inflight = state.inflight.filter(
      (item) => item.id !== id || item.callref !== span.callref,
    );
  }
}

/** A real tag plus the start of the exchange. A release echo alone does not qualify. */
export function spanOpensCard(span: TraceSpan): boolean {
  if (!span.tag) return false;
  if (span.sawUniqueTag) return true;
  return /Set RADIUS-profile\b|Accs-Request \[out-seize\]/i.test(span.text);
}

function requestIdOf(payload: string): number | null {
  const match = payload.match(/Request ID\s*\[(\d+)\]/i);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function isQueueLine(payload: string): boolean {
  return /process queue|Reply queue/i.test(payload);
}

function appendLine(span: TraceSpan, line: string): void {
  span.text = span.text ? `${span.text}\n${line}` : line;
}

function touch(state: TraceState, callref: string): void {
  if (!state.dirty.includes(callref)) state.dirty.push(callref);
}

function payloadOf(line: string): string {
  const rc = line.match(/\brc:\s*(.*)$/i);
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

function markEnd(span: TraceSpan, payload: string): void {
  if (/Release\s+time-stamp:/.test(payload) || /Call rejected/i.test(payload))
    span.ended = true;
}

function markEcho(span: TraceSpan, payload: string): void {
  if (!/unique tag\s*:/i.test(payload)) return;
  span.echoed = true;
  const quoted = payload.match(/unique tag:\s*'([^']*)'/i);
  const tag = quoted?.[1] != null ? realTag(quoted[1]) : null;
  if (tag && !span.tag) span.tag = tag;
  else if (tag && span.tag !== tag) span.mismatch = true;
}

function createSpan(callref: string): TraceSpan {
  return {
    callref,
    tag: "",
    mismatch: false,
    echoed: false,
    ended: false,
    releaseGeneration: null,
    startedKey: "",
    text: "",
    sawUniqueTag: false,
    sealed: false,
    attemptOpen: false,
    pendingBlank: null,
  };
}
