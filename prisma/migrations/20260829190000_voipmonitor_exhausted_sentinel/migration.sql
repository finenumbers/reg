-- Exhausted "not found in VoIPmonitor" rows leave the due queue via next_attempt_at
-- instead of a LIKE filter on evidence_json (hot path for CDR UI + matcher).
UPDATE "cdr_voipmonitor_links"
SET "next_attempt_at" = TIMESTAMPTZ '9999-01-01 00:00:00+00'
WHERE "voipmonitor_url" = ''
  AND "attempt_count" >= 12
  AND (
    "evidence_json" LIKE '%call_id_not_in_index%'
    OR "evidence_json" LIKE '%empty_callid_and_weak_signal%'
    OR "evidence_json" LIKE '%no_candidates_in_window%'
    OR "evidence_json" LIKE '%fallback_below_threshold%'
  );
