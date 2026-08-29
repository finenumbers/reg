/**
 * VoIPmonitor correlation types — Satel CDR → confirmed GUI deep-link.
 */

export const SOURCE_SATEL = "satel_rtu";

export const STATUS_MATCHED_EXACT = "matched_exact";
export const STATUS_MATCHED_FALLBACK = "matched_fallback";
export const STATUS_UNMATCHED = "unmatched";
export const STATUS_AMBIGUOUS = "ambiguous";
export const STATUS_PENDING = "pending";

export const MISS_CALL_ID_NOT_IN_INDEX = "call_id_not_in_index";
export const MISS_EMPTY_CALLID_WEAK_SIGNAL = "empty_callid_and_weak_signal";
export const MISS_FALLBACK_BELOW_THRESHOLD = "fallback_below_threshold";
export const MISS_FALLBACK_AMBIGUOUS = "fallback_ambiguous";
export const MISS_ASSIGNED_ELSEWHERE = "assigned_elsewhere";
export const MISS_NO_CANDIDATES_IN_WINDOW = "no_candidates_in_window";
export const MISS_API_ERROR = "api_error";

export type MatchStatus =
  | typeof STATUS_MATCHED_EXACT
  | typeof STATUS_MATCHED_FALLBACK
  | typeof STATUS_UNMATCHED
  | typeof STATUS_AMBIGUOUS
  | typeof STATUS_PENDING
  | "";

export type CdrCandidate = {
  sourceRecordId: string;
  sourceSystem: string;
  sourceCdrId: string;
  setupTime: Date;
  durationSec: number | null;
  connectDurationSec: number | null;
  caller: string;
  called: string;
  callerNumbers: string[];
  calledNumbers: string[];
  callerIp: string;
  calledIp: string;
  sipCallIds: string[];
  inCallIds: string[];
  outCallIds: string[];
  inCaller: string;
  inCalled: string;
  outCaller: string;
  outCalled: string;
  inIp: string;
  outIp: string;
};

export type VoipmonitorLegRef = {
  url: string;
  cdrId: string;
  callId: string;
};

export type VoipmonitorLegs = {
  in?: VoipmonitorLegRef;
  out?: VoipmonitorLegRef;
};

export type VmCall = {
  cdrId: string;
  callId: string;
  callDate: Date | null;
  callEnd: Date | null;
  duration: number;
  connectDuration: number;
  caller: string;
  called: string;
  sipCallerIp: string;
  sipCalledIp: string;
};

export type MatchResult = {
  status: MatchStatus;
  method: string;
  score: number;
  vm: VmCall | null;
  cardUrl: string;
  legs: VoipmonitorLegs;
  evidenceJson: string;
  matchedAt: Date | null;
  missReason: string;
};

export type CardUrlParts = {
  cdrId?: string;
  callId: string;
  callDate?: Date | null;
};

export type RangeFetchMeta = {
  sliceSplits: number;
  clipped: boolean;
  suspectedCap: boolean;
};

export type MatchBucketStats = {
  hourFetchCount: number;
  probes: number;
  probeBudget: number;
  sliceSplits: number;
  clipped: boolean;
  suspectedCap: boolean;
  fetchMs: number;
  matchMs: number;
};

export type VoipmonitorClientLike = {
  listVoipCallsRange(from: Date, to: Date): Promise<VmCall[]>;
  getVoipCalls(params: Record<string, unknown>): Promise<VmCall[]>;
  lastRangeMeta?: RangeFetchMeta | null;
};
