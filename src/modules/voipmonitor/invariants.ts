import {
  STATUS_MATCHED_EXACT,
  STATUS_MATCHED_FALLBACK,
  STATUS_AMBIGUOUS,
  STATUS_UNMATCHED,
  type CdrCandidate,
  type MatchResult,
} from "@/modules/voipmonitor/types";
import { callIdsEqual } from "@/modules/voipmonitor/normalize";

export function auditExactCallIdInvariant(
  cdr: CdrCandidate,
  result: MatchResult,
): boolean {
  if (result.status !== STATUS_MATCHED_EXACT) return true;
  if (!result.vm) return false;
  return cdr.sipCallIds.some((raw) => callIdsEqual(raw, result.vm!.callId));
}

export function auditLinkInvariants(
  candidates: CdrCandidate[],
  results: MatchResult[],
): string[] {
  if (candidates.length !== results.length) {
    return ["candidate/result length mismatch"];
  }
  const issues: string[] = [];
  const used = new Map<string, number>();
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (
      result.cardUrl &&
      result.status !== STATUS_MATCHED_EXACT &&
      result.status !== STATUS_MATCHED_FALLBACK
    ) {
      issues.push(`url_without_match_status[${i}]=${result.status}`);
    }
    if (
      result.cardUrl &&
      (result.cardUrl.includes("fId:") ||
        result.cardUrl.includes("fId%3A") ||
        result.cardUrl.includes("fId%3a"))
    ) {
      issues.push(`legacy_fid_url[${i}]`);
    }
    if (
      (result.status === STATUS_UNMATCHED ||
        result.status === STATUS_AMBIGUOUS) &&
      !result.missReason
    ) {
      let ev: Record<string, unknown> = {};
      try {
        ev = JSON.parse(result.evidenceJson) as Record<string, unknown>;
      } catch {
        ev = {};
      }
      if (!("miss_reason" in ev)) {
        issues.push(`missing_miss_reason[${i}]`);
      }
    }
    if (result.status === STATUS_MATCHED_FALLBACK) {
      try {
        const ev = JSON.parse(result.evidenceJson) as Record<string, unknown>;
        if (ev.call_id_hits !== undefined && ev.call_id_hits !== 0) {
          issues.push(`fallback_with_call_id_hits[${i}]`);
        }
      } catch {
        /* ignore */
      }
    }
    if (!auditExactCallIdInvariant(candidates[i]!, result)) {
      issues.push(`exact_call_id_invariant[${i}]`);
    }
    if (
      result.status === STATUS_MATCHED_EXACT ||
      result.status === STATUS_MATCHED_FALLBACK
    ) {
      const ids = new Set<string>();
      if (result.vm?.cdrId) ids.add(result.vm.cdrId);
      if (result.legs.in?.cdrId) ids.add(result.legs.in.cdrId);
      if (result.legs.out?.cdrId) ids.add(result.legs.out.cdrId);
      for (const cdrId of ids) {
        const prev = used.get(cdrId);
        if (prev !== undefined) {
          issues.push(`duplicate_vm_cdr_id[${prev},${i}]=${cdrId}`);
        } else {
          used.set(cdrId, i);
        }
      }
    }
  }
  return issues;
}
