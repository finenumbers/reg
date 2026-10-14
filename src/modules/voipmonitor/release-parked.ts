import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { QUEUE_EXHAUSTED_AT, RETRY_BACKOFF_MS } from "@/modules/voipmonitor/constants";
import { STATUS_AMBIGUOUS, STATUS_UNMATCHED } from "@/modules/voipmonitor/types";

const BATCH = 500;

/**
 * Postgres form of a whole `miss_reason` value. `miss_reason_seed` does not match:
 * the quote has to close immediately after `miss_reason`.
 */
export const FALSELY_PARKED_EVIDENCE_SQL =
  '"miss_reason"[[:space:]]*:[[:space:]]*"(assigned_elsewhere|fallback_ambiguous)"';

const FALSELY_PARKED_EVIDENCE_RE =
  /"miss_reason"\s*:\s*"(assigned_elsewhere|fallback_ambiguous)"/;

export function evidenceIsFalselyParked(evidenceJson: string): boolean {
  return FALSELY_PARKED_EVIDENCE_RE.test(evidenceJson);
}

/**
 * Rows parked at year 9999 because a seed reason was still in the JSON.
 * `attempt_count` stays. The new due time is the same backoff a fresh miss
 * at that attempt count would get. Real not-found rows stay parked.
 */
export async function releaseFalselyParkedMisses(now = new Date()): Promise<number> {
  const due = new Date(now.getTime() + RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!);
  let released = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ cdr_record_id: string }[]>`
      SELECT cdr_record_id
      FROM cdr_voipmonitor_links
      WHERE match_status IN (${Prisma.join([STATUS_UNMATCHED, STATUS_AMBIGUOUS])})
        AND next_attempt_at >= ${QUEUE_EXHAUSTED_AT}
        AND evidence_json ~ ${FALSELY_PARKED_EVIDENCE_SQL}
      LIMIT ${BATCH}
    `;
    if (rows.length === 0) break;
    const ids = rows.map((row) => row.cdr_record_id);
    const updated = await prisma.$executeRaw`
      UPDATE cdr_voipmonitor_links
      SET next_attempt_at = ${due}
      WHERE cdr_record_id IN (${Prisma.join(ids)})
        AND next_attempt_at >= ${QUEUE_EXHAUSTED_AT}
    `;
    released += updated;
    if (updated === 0 || rows.length < BATCH) break;
  }
  return released;
}
