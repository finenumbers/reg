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
  evidenceJson: string;
  matchedAt: Date | null;
  missReason: string;
};

export type CardUrlParts = {
  cdrId?: string;
  callId: string;
  callDate?: Date | null;
};

export type VoipmonitorClientLike = {
  listVoipCallsRange(from: Date, to: Date): Promise<VmCall[]>;
  getVoipCalls(params: Record<string, unknown>): Promise<VmCall[]>;
};
