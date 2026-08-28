/**
 * Hybrid VoIPmonitor matcher — port of Collector match.go (Satel-capable).
 */

import {
  CALL_ID_WINDOW_MS,
  DISAMBIGUITY_MARGIN,
  FALLBACK_WINDOW_MAX_MS,
  FALLBACK_WINDOW_MS,
  MIN_SCORE,
  NUMBER_SUFFIX_LEN,
} from "@/modules/voipmonitor/constants";
import { effectiveProbeBudget } from "@/modules/voipmonitor/probe-budget";
import {
  callIdQueryVariants,
  callIdVariants,
  cdrCalledNumbers,
  cdrCallerNumbers,
  digits,
  ipEqual,
  normalizeCallId,
  numberSuffixes,
  sourceCallIdNorms,
} from "@/modules/voipmonitor/normalize";
import {
  MISS_API_ERROR,
  MISS_ASSIGNED_ELSEWHERE,
  MISS_CALL_ID_NOT_IN_INDEX,
  MISS_EMPTY_CALLID_WEAK_SIGNAL,
  MISS_FALLBACK_AMBIGUOUS,
  MISS_FALLBACK_BELOW_THRESHOLD,
  MISS_NO_CANDIDATES_IN_WINDOW,
  SOURCE_SATEL,
  STATUS_AMBIGUOUS,
  STATUS_MATCHED_EXACT,
  STATUS_MATCHED_FALLBACK,
  STATUS_UNMATCHED,
  type CdrCandidate,
  type MatchBucketStats,
  type MatchResult,
  type VmCall,
  type VoipmonitorClientLike,
} from "@/modules/voipmonitor/types";
import { buildCardUrl } from "@/modules/voipmonitor/url";

export type MatcherOptions = {
  client: VoipmonitorClientLike;
  guiBase: string;
  cardTemplate?: string;
  callIdWindowMs?: number;
  fallbackWindowMs?: number;
  fallbackWindowMaxMs?: number;
  minScore?: number;
  disambiguityMargin?: number;
  numberSuffixLen?: number;
  now?: () => Date;
  /** Unique Call-IDs to probe after the hour index miss. 0 = none. */
  probeBudget?: number;
};

type MatchOpts = {
  callIdWindowMs: number;
  fallbackMs: number;
  fallbackMaxMs: number;
  minScore: number;
  margin: number;
  suffixLen: number;
};

type CallIndex = {
  byCallId: Map<string, VmCall[]>;
  byCdrId: Map<string, VmCall>;
  all: VmCall[];
};

type PendingMatch = {
  candIdx: number;
  call: VmCall;
  score: number;
  method: string;
  status: string;
  evidence: Record<string, unknown>;
  legs: VmCall[];
};

type ScoredCall = {
  call: VmCall;
  score: number;
  numberOk: boolean;
  ipOk: boolean;
  allowIpOnly: boolean;
};

function resolveOpts(input: MatcherOptions): MatchOpts {
  let callIdWindowMs = input.callIdWindowMs ?? CALL_ID_WINDOW_MS;
  if (callIdWindowMs <= 0) callIdWindowMs = CALL_ID_WINDOW_MS;
  let fallbackMs = input.fallbackWindowMs ?? FALLBACK_WINDOW_MS;
  if (fallbackMs <= 0) fallbackMs = FALLBACK_WINDOW_MS;
  let fallbackMaxMs = input.fallbackWindowMaxMs ?? FALLBACK_WINDOW_MAX_MS;
  if (fallbackMaxMs <= 0) fallbackMaxMs = FALLBACK_WINDOW_MAX_MS;
  if (fallbackMaxMs < fallbackMs) fallbackMaxMs = fallbackMs;
  let minScore = input.minScore ?? MIN_SCORE;
  if (minScore <= 0) minScore = MIN_SCORE;
  let margin = input.disambiguityMargin ?? DISAMBIGUITY_MARGIN;
  if (margin <= 0) margin = DISAMBIGUITY_MARGIN;
  let suffixLen = input.numberSuffixLen ?? NUMBER_SUFFIX_LEN;
  if (suffixLen <= 0) suffixLen = NUMBER_SUFFIX_LEN;
  return {
    callIdWindowMs,
    fallbackMs,
    fallbackMaxMs,
    minScore,
    margin,
    suffixLen,
  };
}

function appendUniqueCall(list: VmCall[], call: VmCall): VmCall[] {
  if (call.cdrId && list.some((existing) => existing.cdrId === call.cdrId)) {
    return list;
  }
  return [...list, call];
}

function buildCallIndex(calls: VmCall[]): CallIndex {
  const idx: CallIndex = {
    byCallId: new Map(),
    byCdrId: new Map(),
    all: [],
  };
  mergeCalls(idx, calls);
  return idx;
}

function mergeCalls(idx: CallIndex, calls: VmCall[]): void {
  for (const call of calls) {
    if (call.cdrId) {
      if (!idx.byCdrId.has(call.cdrId)) {
        idx.byCdrId.set(call.cdrId, call);
        idx.all.push(call);
      }
    } else {
      idx.all.push(call);
    }
    for (const key of callIdVariants(call.callId)) {
      const prev = idx.byCallId.get(key) ?? [];
      idx.byCallId.set(key, appendUniqueCall(prev, call));
    }
  }
}

function formatApiTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

function bucketBounds(candidates: CdrCandidate[]): { from: Date; to: Date } {
  let from = candidates[0]!.setupTime;
  let to = from;
  for (const c of candidates.slice(1)) {
    if (c.setupTime < from) from = c.setupTime;
    if (c.setupTime > to) to = c.setupTime;
  }
  return { from, to: new Date(to.getTime() + 1000) };
}

function mustJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function cloneEvidence(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return { ...input };
}

function missResult(
  reason: string,
  evidence: Record<string, unknown> | undefined,
): MatchResult {
  const ev = evidence ?? {};
  ev.miss_reason = reason;
  let status: MatchResult["status"] = STATUS_UNMATCHED;
  let method = "none";
  if (reason === MISS_FALLBACK_AMBIGUOUS) {
    status = STATUS_AMBIGUOUS;
    method = "fallback_numbers_ip_time";
  }
  return {
    status,
    method,
    score: 0,
    vm: null,
    cardUrl: "",
    missReason: reason,
    evidenceJson: mustJson(ev),
    matchedAt: null,
  };
}

function methodForCallIdAttempt(source: string, index: number): string {
  if (source !== SOURCE_SATEL) {
    return index === 0 ? "sip_call_id_in" : "sip_call_id_out";
  }
  switch (index) {
    case 0:
      return "rtu_call_id_out_proto";
    case 1:
      return "rtu_src_out_leg_call_id";
    case 2:
      return "rtu_call_id_in";
    case 3:
      return "rtu_src_in_leg_call_id";
    case 4:
      return "rtu_src_in_leg_conf_id";
    case 5:
      return "rtu_conf_id";
    default:
      return `rtu_call_id_${index}`;
  }
}

function success(
  guiBase: string,
  cardTemplate: string,
  call: VmCall,
  status: string,
  method: string,
  score: number,
  evidence: Record<string, unknown> | undefined,
  now: Date,
): MatchResult {
  const ev = evidence ?? {};
  const cardUrl = buildCardUrl(cardTemplate, guiBase, {
    cdrId: call.cdrId,
    callId: call.callId,
    callDate: call.callDate,
  });
  ev.selected = {
    cdrId: call.cdrId,
    callId: call.callId,
    score,
    method,
  };
  return {
    status: status as MatchResult["status"],
    method,
    score,
    vm: call,
    cardUrl,
    evidenceJson: mustJson(ev),
    matchedAt: now,
    missReason: "",
  };
}

function timeDeltaMs(cdr: CdrCandidate, hit: VmCall): number {
  if (!hit.callDate) return 24 * 60 * 60 * 1000;
  return Math.abs(hit.callDate.getTime() - cdr.setupTime.getTime());
}

function cdrIdLess(a: string, b: string): boolean {
  const ai = Number.parseInt(digits(a), 10);
  const bi = Number.parseInt(digits(b), 10);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) {
    return ai > bi;
  }
  return a > b;
}

function bestNumberMatch(
  sources: string[],
  primary: string[],
  alternate: string[],
  suffixLen: number,
): { ok: boolean; side: string } {
  for (const src of sources) {
    for (const s of numberSuffixes(src, suffixLen)) {
      if (primary.includes(s)) return { ok: true, side: "direct" };
      if (alternate.includes(s)) return { ok: true, side: "swap" };
    }
  }
  return { ok: false, side: "" };
}

function scoreOne(
  cdr: CdrCandidate,
  hit: VmCall,
  suffixLen: number,
  requireStrong: boolean,
): ScoredCall {
  let score = 0;
  const callerNums = cdrCallerNumbers(cdr);
  const calledNums = cdrCalledNumbers(cdr);
  const callerHit = numberSuffixes(hit.caller, suffixLen);
  const calledHit = numberSuffixes(hit.called, suffixLen);
  const caller = bestNumberMatch(callerNums, callerHit, calledHit, suffixLen);
  const called = bestNumberMatch(calledNums, calledHit, callerHit, suffixLen);
  let numberOk = false;
  let allowIpOnly = false;
  if (caller.ok && called.ok) {
    numberOk = true;
    score += 40;
    if (caller.side === "swap" || called.side === "swap") score += 5;
  } else if (caller.ok || called.ok) {
    score += 18;
    numberOk = !requireStrong;
  }

  const ipOk =
    ipEqual(cdr.callerIp, hit.sipCallerIp) ||
    ipEqual(cdr.callerIp, hit.sipCalledIp) ||
    ipEqual(cdr.calledIp, hit.sipCallerIp) ||
    ipEqual(cdr.calledIp, hit.sipCalledIp);
  if (ipOk) score += 20;
  if (requireStrong && (caller.ok || called.ok) && ipOk) {
    numberOk = true;
    score += 10;
  }
  if (
    requireStrong &&
    !caller.ok &&
    !called.ok &&
    ipOk &&
    callerNums.length === 0 &&
    calledNums.length === 0
  ) {
    allowIpOnly = true;
  }

  if (hit.callDate) {
    const delta = Math.abs(hit.callDate.getTime() - cdr.setupTime.getTime());
    if (delta <= 2000) score += 25;
    else if (delta <= 15_000) score += 18;
    else if (delta <= 60_000) score += 12;
    else if (delta <= 120_000) score += 8;
    else if (delta <= 600_000) score += 4;
  }
  if (cdr.durationSec != null && cdr.durationSec > 0) {
    const diff = Math.abs(cdr.durationSec - hit.duration);
    if (diff <= 1) score += 15;
    else if (diff <= 3) score += 10;
    else if (diff <= 8) score += 5;
  }
  if (
    cdr.connectDurationSec != null &&
    cdr.connectDurationSec > 0 &&
    hit.connectDuration > 0
  ) {
    if (Math.abs(cdr.connectDurationSec - hit.connectDuration) <= 2) {
      score += 5;
    }
  }
  if (score > 100) score = 100;
  return { call: hit, score, numberOk, ipOk, allowIpOnly };
}

function scoreFallbackCandidates(
  cdr: CdrCandidate,
  calls: VmCall[],
  used: Map<string, number>,
  windowMs: number,
  suffixLen: number,
): ScoredCall[] {
  const out: ScoredCall[] = [];
  for (const hit of calls) {
    if (hit.cdrId && used.has(hit.cdrId)) continue;
    if (hit.callDate) {
      if (
        Math.abs(hit.callDate.getTime() - cdr.setupTime.getTime()) > windowMs
      ) {
        continue;
      }
    }
    const scored = scoreOne(cdr, hit, suffixLen, true);
    if (scored.score === 0) continue;
    if (!scored.numberOk && !scored.ipOk) continue;
    if (scored.numberOk || scored.allowIpOnly) out.push(scored);
  }
  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.call.cdrId < b.call.cdrId ? -1 : a.call.cdrId > b.call.cdrId ? 1 : 0;
  });
  return out;
}

function orderLegs(
  cdr: CdrCandidate,
  hits: VmCall[],
  suffixLen: number,
): { ordered: VmCall[]; score: number } {
  const scored = hits.map((hit) => scoreOne(cdr, hit, suffixLen, false));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.ipOk !== b.ipOk) return a.ipOk ? -1 : 1;
    const di = timeDeltaMs(cdr, a.call);
    const dj = timeDeltaMs(cdr, b.call);
    if (di !== dj) return di - dj;
    return cdrIdLess(a.call.cdrId, b.call.cdrId) ? -1 : 1;
  });
  return { ordered: scored.map((s) => s.call), score: 100 };
}

function stageExact(
  cdr: CdrCandidate,
  idx: CallIndex,
  opts: MatchOpts,
  probeAttempts: unknown[] | null,
): PendingMatch | null {
  const norms = sourceCallIdNorms(cdr);
  const evidence: Record<string, unknown> = {
    stage: "exact_call_id",
    source_system: cdr.sourceSystem,
    source_call_ids_normalized: norms,
    setup_time: cdr.setupTime.toISOString(),
  };
  if (probeAttempts && probeAttempts.length > 0) {
    evidence.call_id_probes = probeAttempts;
  }
  if (norms.length === 0 && cdr.sipCallIds.length === 0) return null;
  const hits: VmCall[] = [];
  const seenCdr = new Set<string>();
  let matchedNorm = "";
  for (let i = 0; i < cdr.sipCallIds.length; i++) {
    const raw = cdr.sipCallIds[i]!;
    for (const norm of callIdVariants(raw)) {
      const group = idx.byCallId.get(norm);
      if (!group?.length) continue;
      if (!matchedNorm) {
        matchedNorm = norm;
        evidence.matched_call_id_norm = norm;
        evidence.method_seed = methodForCallIdAttempt(cdr.sourceSystem, i);
      }
      for (const hit of group) {
        const key =
          hit.cdrId ||
          `${hit.callId}|${hit.callDate?.toISOString() ?? ""}`;
        if (seenCdr.has(key)) continue;
        seenCdr.add(key);
        hits.push(hit);
      }
    }
  }
  if (hits.length === 0) return null;
  evidence.vm_legs_with_same_call_id = hits.length;
  const { ordered, score } = orderLegs(cdr, hits, opts.suffixLen);
  const winner = ordered[0]!;
  evidence.selected = {
    cdrId: winner.cdrId,
    callId: winner.callId,
    score,
  };
  if (ordered.length > 1) {
    evidence.runner_up = {
      cdrId: ordered[1]!.cdrId,
      callId: ordered[1]!.callId,
    };
  }
  let method = (evidence.method_seed as string) || "sip_call_id";
  if (hits.length > 1) {
    method = `${method}_multi_leg`;
    evidence.multi_leg_disambiguated = true;
  }
  return {
    candIdx: 0,
    call: winner,
    score,
    method,
    status: STATUS_MATCHED_EXACT,
    evidence,
    legs: ordered,
  };
}

function stageFallback(
  cdr: CdrCandidate,
  idx: CallIndex,
  opts: MatchOpts,
  used: Map<string, number>,
  fetchMeta: Record<string, unknown>,
): { pending: PendingMatch | null; miss: MatchResult | null } {
  const norms = sourceCallIdNorms(cdr);
  const evidence: Record<string, unknown> = {
    stage: "fallback",
    source_system: cdr.sourceSystem,
    source_call_ids_normalized: norms,
    call_id_hits: 0,
    setup_time: cdr.setupTime.toISOString(),
    hour_fetch: fetchMeta,
  };
  evidence.miss_reason_seed =
    norms.length > 0 ? MISS_CALL_ID_NOT_IN_INDEX : MISS_EMPTY_CALLID_WEAK_SIGNAL;

  let scored = scoreFallbackCandidates(
    cdr,
    idx.all,
    used,
    opts.fallbackMs,
    opts.suffixLen,
  );
  evidence.candidates_in_window = scored.length;
  if (scored.length === 0) {
    scored = scoreFallbackCandidates(
      cdr,
      idx.all,
      used,
      opts.fallbackMaxMs,
      opts.suffixLen,
    );
    evidence.expanded_window = true;
    evidence.candidates_in_window = scored.length;
  }
  if (scored.length === 0) {
    const reason =
      typeof evidence.miss_reason_seed === "string"
        ? evidence.miss_reason_seed
        : MISS_NO_CANDIDATES_IN_WINDOW;
    return { pending: null, miss: missResult(reason, evidence) };
  }

  const best = scored[0]!;
  const runner = scored[1];
  evidence.gates = {
    min_score: opts.minScore,
    margin: opts.margin,
    best_score: best.score,
    number_ok: best.numberOk,
    ip_ok: best.ipOk,
  };
  evidence.selected = {
    cdrId: best.call.cdrId,
    callId: best.call.callId,
    score: best.score,
  };
  if (runner) {
    evidence.runner_up = {
      cdrId: runner.call.cdrId,
      callId: runner.call.callId,
      score: runner.score,
    };
  }

  if (!best.numberOk && !best.ipOk) {
    return {
      pending: null,
      miss: missResult(MISS_EMPTY_CALLID_WEAK_SIGNAL, evidence),
    };
  }
  if (!best.numberOk && !best.allowIpOnly) {
    return {
      pending: null,
      miss: missResult(MISS_FALLBACK_BELOW_THRESHOLD, evidence),
    };
  }
  if (best.score < opts.minScore) {
    return {
      pending: null,
      miss: missResult(MISS_FALLBACK_BELOW_THRESHOLD, evidence),
    };
  }
  if (runner && best.score - runner.score < opts.margin) {
    evidence.miss_reason = MISS_FALLBACK_AMBIGUOUS;
    return {
      pending: null,
      miss: {
        status: STATUS_AMBIGUOUS,
        method: "fallback_numbers_ip_time",
        score: best.score,
        vm: null,
        cardUrl: "",
        missReason: MISS_FALLBACK_AMBIGUOUS,
        evidenceJson: mustJson(evidence),
        matchedAt: null,
      },
    };
  }

  return {
    pending: {
      candIdx: 0,
      call: best.call,
      score: best.score,
      method: "fallback_numbers_ip_time",
      status: STATUS_MATCHED_FALLBACK,
      evidence,
      legs: [best.call],
    },
    miss: null,
  };
}

function assignBucket(
  options: MatcherOptions,
  candidates: CdrCandidate[],
  idx: CallIndex,
  opts: MatchOpts,
  now: Date,
  fetchMeta: Record<string, unknown>,
  probeAttempts: unknown[],
): MatchResult[] {
  const results: MatchResult[] = Array.from({ length: candidates.length }, () =>
    missResult(MISS_NO_CANDIDATES_IN_WINDOW, {}),
  );
  const used = new Map<string, number>();
  const exact: PendingMatch[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const pm = stageExact(candidates[i]!, idx, opts, probeAttempts);
    if (!pm) continue;
    pm.candIdx = i;
    pm.evidence.hour_fetch = fetchMeta;
    exact.push(pm);
  }
  exact.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : a.candIdx - b.candIdx,
  );
  const assigned = new Array<boolean>(candidates.length).fill(false);
  for (const pm of exact) {
    if (assigned[pm.candIdx]) continue;
    const legs = pm.legs.length ? pm.legs : [pm.call];
    let picked = false;
    for (const leg of legs) {
      if (leg.cdrId) {
        const owner = used.get(leg.cdrId);
        if (owner !== undefined && owner !== pm.candIdx) continue;
        used.set(leg.cdrId, pm.candIdx);
      }
      const ev = cloneEvidence(pm.evidence);
      ev.selected = {
        cdrId: leg.cdrId,
        callId: leg.callId,
        score: pm.score,
      };
      results[pm.candIdx] = success(
        options.guiBase,
        options.cardTemplate ?? "",
        leg,
        pm.status,
        pm.method,
        pm.score,
        ev,
        now,
      );
      assigned[pm.candIdx] = true;
      picked = true;
      break;
    }
    if (!picked) {
      results[pm.candIdx] = missResult(
        MISS_ASSIGNED_ELSEWHERE,
        cloneEvidence(pm.evidence),
      );
      assigned[pm.candIdx] = true;
    }
  }

  const fallback: PendingMatch[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (assigned[i]) continue;
    const { pending, miss } = stageFallback(
      candidates[i]!,
      idx,
      opts,
      used,
      fetchMeta,
    );
    if (!pending) {
      if (miss) results[i] = miss;
      continue;
    }
    pending.candIdx = i;
    fallback.push(pending);
  }
  fallback.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : a.candIdx - b.candIdx,
  );
  for (const pm of fallback) {
    if (assigned[pm.candIdx]) continue;
    if (pm.call.cdrId) {
      const owner = used.get(pm.call.cdrId);
      if (owner !== undefined && owner !== pm.candIdx) {
        const ev = pm.evidence;
        ev.miss_reason = MISS_ASSIGNED_ELSEWHERE;
        ev.taken_by_candidate = owner;
        results[pm.candIdx] = missResult(MISS_ASSIGNED_ELSEWHERE, ev);
        continue;
      }
      used.set(pm.call.cdrId, pm.candIdx);
    }
    results[pm.candIdx] = success(
      options.guiBase,
      options.cardTemplate ?? "",
      pm.call,
      pm.status,
      pm.method,
      pm.score,
      pm.evidence,
      now,
    );
    assigned[pm.candIdx] = true;
  }

  for (let i = 0; i < results.length; i++) {
    if (!assigned[i] && !results[i]?.status) {
      results[i] = missResult(MISS_NO_CANDIDATES_IN_WINDOW, {
        stage: "unassigned",
        source_call_ids_normalized: sourceCallIdNorms(candidates[i]!),
        hour_fetch: fetchMeta,
      });
    }
  }
  return results;
}

export async function matchBucket(
  options: MatcherOptions,
  candidates: CdrCandidate[],
): Promise<{ results: MatchResult[]; error?: Error; stats?: MatchBucketStats }> {
  const opts = resolveOpts(options);
  const now = options.now ? options.now() : new Date();
  if (candidates.length === 0) {
    return {
      results: [],
      stats: emptyStats(0, options.probeBudget ?? 0),
    };
  }
  const { from, to } = bucketBounds(candidates);
  const fetchFrom = new Date(from.getTime() - opts.callIdWindowMs);
  const fetchTo = new Date(to.getTime() + opts.callIdWindowMs);
  const fetchStarted = Date.now();
  let hourCalls: VmCall[];
  try {
    hourCalls = await options.client.listVoipCallsRange(fetchFrom, fetchTo);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      results: candidates.map(() =>
        missResult(MISS_API_ERROR, {
          stage: "hour_fetch",
          error: err.message,
          fetch_from: fetchFrom.toISOString(),
          fetch_to: fetchTo.toISOString(),
        }),
      ),
      error: err,
      stats: emptyStats(0, 0, Date.now() - fetchStarted),
    };
  }
  const fetchMs = Date.now() - fetchStarted;
  const rangeMeta = options.client.lastRangeMeta;
  const fetchLooksIncomplete = Boolean(
    rangeMeta?.clipped || rangeMeta?.suspectedCap,
  );
  const budget = effectiveProbeBudget(
    options.probeBudget ?? 0,
    hourCalls.length,
    fetchLooksIncomplete,
  );
  const idx = buildCallIndex(hourCalls);
  const fetchMeta: Record<string, unknown> = {
    hour_fetch_count: hourCalls.length,
    fetch_from: fetchFrom.toISOString(),
    fetch_to: fetchTo.toISOString(),
    probe_budget: budget,
    slice_splits: rangeMeta?.sliceSplits ?? 0,
    suspected_cap: fetchLooksIncomplete,
  };

  const missCandidates = candidates.filter(
    (cdr) => !stageExact(cdr, idx, opts, null),
  );
  const probeAttempts: unknown[] = [];
  const seenProbe = new Set<string>();
  const matchStarted = Date.now();
  for (const cdr of missCandidates) {
    if (seenProbe.size >= budget) break;
    for (const raw of cdr.sipCallIds) {
      if (seenProbe.size >= budget) break;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const norm = normalizeCallId(trimmed);
      if (seenProbe.has(norm)) continue;
      for (const q of callIdQueryVariants(trimmed)) {
        try {
          const hits = await options.client.getVoipCalls({
            startTime: formatApiTime(fetchFrom),
            startTimeTo: formatApiTime(fetchTo),
            callId: q,
          });
          probeAttempts.push({ callId: q, hits: hits.length });
          if (hits.length > 0) {
            mergeCalls(idx, hits);
            break;
          }
        } catch (error) {
          probeAttempts.push({
            callId: q,
            hits: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      seenProbe.add(norm);
    }
  }
  fetchMeta.call_id_probes = probeAttempts.length;
  const results = assignBucket(
    options,
    candidates,
    idx,
    opts,
    now,
    fetchMeta,
    probeAttempts,
  );
  return {
    results,
    stats: {
      hourFetchCount: hourCalls.length,
      probes: probeAttempts.length,
      probeBudget: budget,
      sliceSplits: rangeMeta?.sliceSplits ?? 0,
      clipped: Boolean(rangeMeta?.clipped),
      suspectedCap: Boolean(rangeMeta?.suspectedCap),
      fetchMs,
      matchMs: Date.now() - matchStarted,
    },
  };
}

function emptyStats(
  hourFetchCount: number,
  probeBudget: number,
  fetchMs = 0,
): MatchBucketStats {
  return {
    hourFetchCount,
    probes: 0,
    probeBudget,
    sliceSplits: 0,
    clipped: false,
    suspectedCap: false,
    fetchMs,
    matchMs: 0,
  };
}

export async function matchOne(
  options: MatcherOptions,
  cdr: CdrCandidate,
): Promise<{ result: MatchResult; error?: Error }> {
  const { results, error } = await matchBucket(options, [cdr]);
  if (results.length === 0) {
    return {
      result: {
        status: STATUS_UNMATCHED,
        method: "none",
        score: 0,
        vm: null,
        cardUrl: "",
        evidenceJson: "{}",
        matchedAt: null,
        missReason: "",
      },
      error,
    };
  }
  return { result: results[0]!, error };
}
