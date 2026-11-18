import { callIdsEqual } from "@/modules/voipmonitor/normalize";
import type {
  CdrCandidate,
  VoipmonitorLegRef,
  VoipmonitorLegs,
} from "@/modules/voipmonitor/types";
import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";

export const RTP_PRESENT = "Есть";
export const RTP_ABSENT = "Нет";

export type VisibleCalltraceLeg = {
  url: string;
  cdrId: string;
  audio?: boolean;
};

export function callIdMatchesAny(callId: string, raws: string[]): boolean {
  return raws.some((raw) => callIdsEqual(raw, callId));
}

export function classifyCallId(
  callId: string,
  cdr: CdrCandidate,
): { in: boolean; out: boolean } {
  return {
    in: callIdMatchesAny(callId, cdr.inCallIds),
    out: callIdMatchesAny(callId, cdr.outCallIds),
  };
}

export function parseVoipmonitorLegs(value: unknown): VoipmonitorLegs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const inn = parseLegRef(raw.in);
  const out = parseLegRef(raw.out);
  const legs: VoipmonitorLegs = {};
  if (inn) legs.in = inn;
  if (out) legs.out = out;
  return legs;
}

export function collectLegCdrIds(legs: VoipmonitorLegs): string[] {
  const ids: string[] = [];
  if (legs.in?.cdrId) ids.push(legs.in.cdrId);
  if (legs.out?.cdrId) ids.push(legs.out.cdrId);
  return ids;
}

function parseLegRef(value: unknown): VoipmonitorLegRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === "string" ? raw.url : "";
  const cdrId = typeof raw.cdrId === "string" ? raw.cdrId : "";
  const callId = typeof raw.callId === "string" ? raw.callId : "";
  if (!url && !cdrId && !callId) return undefined;
  const ref: VoipmonitorLegRef = { url, cdrId, callId };
  if (raw.audio === true || raw.audio === false) ref.audio = raw.audio;
  return ref;
}

/** The leg the Calltrace cell shows. An unsafe or empty link has no URL. */
export function visibleCalltraceLeg(
  ref: VoipmonitorLegRef | undefined,
  guiUrl: string,
): VisibleCalltraceLeg {
  if (!ref?.url || !guiUrl || !isSafeVoipmonitorHref(ref.url, guiUrl)) {
    return { url: "", cdrId: "" };
  }
  if (ref.audio === true || ref.audio === false) {
    return { url: ref.url, cdrId: ref.cdrId, audio: ref.audio };
  }
  return { url: ref.url, cdrId: ref.cdrId };
}

/**
 * One RTP word for the row. A visible Out leg decides alone.
 * In is used only when Out is not shown.
 */
export function rtpMark(
  inn: VisibleCalltraceLeg,
  out: VisibleCalltraceLeg,
): string {
  const leg = out.url ? out : inn.url ? inn : undefined;
  if (!leg) return "";
  if (leg.audio === true) return RTP_PRESENT;
  if (leg.audio === false) return RTP_ABSENT;
  return "";
}

export function calltraceCells(
  legs: VoipmonitorLegs,
  guiUrl: string,
): {
  inUrl: string;
  inId: string;
  outUrl: string;
  outId: string;
  rtp: string;
} {
  const inn = visibleCalltraceLeg(legs.in, guiUrl);
  const out = visibleCalltraceLeg(legs.out, guiUrl);
  return {
    inUrl: inn.url,
    inId: inn.cdrId,
    outUrl: out.url,
    outId: out.cdrId,
    rtp: rtpMark(inn, out),
  };
}
