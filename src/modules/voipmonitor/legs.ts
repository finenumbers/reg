import { callIdsEqual } from "@/modules/voipmonitor/normalize";
import type {
  CdrCandidate,
  VoipmonitorLegRef,
  VoipmonitorLegs,
} from "@/modules/voipmonitor/types";

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
  return { url, cdrId, callId };
}
