import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { nextAttemptAt } from "@/modules/voipmonitor/backoff";
import { QUEUE_EXHAUSTED_AT } from "@/modules/voipmonitor/constants";
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
function attemptCountOf(value: unknown): number {
  const count = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.trunc(count);
}

export async function releaseFalselyParkedMisses(now = new Date()): Promise<number> {
  let released = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ cdr_record_id: string; attempt_count: unknown }[]>`
      SELECT cdr_record_id, attempt_count
      FROM cdr_voipmonitor_links
      WHERE match_status IN (${Prisma.join([STATUS_UNMATCHED, STATUS_AMBIGUOUS])})
        AND next_attempt_at >= ${QUEUE_EXHAUSTED_AT}
        AND evidence_json ~ ${FALSELY_PARKED_EVIDENCE_SQL}
      LIMIT ${BATCH}
    `;
    if (rows.length === 0) break;
    const groups = new Map<number, string[]>();
    for (const row of rows) {
      const attempt = attemptCountOf(row.attempt_count);
      const ids = groups.get(attempt) ?? [];
      ids.push(row.cdr_record_id);
      groups.set(attempt, ids);
    }
    let updatedThisPass = 0;
    for (const [attempt, ids] of groups) {
      const due = nextAttemptAt(attempt, now);
      const updated = await prisma.$executeRaw`
        UPDATE cdr_voipmonitor_links
        SET next_attempt_at = ${due}
        WHERE cdr_record_id IN (${Prisma.join(ids)})
          AND next_attempt_at >= ${QUEUE_EXHAUSTED_AT}
      `;
      updatedThisPass += Number(updated) || 0;
    }
    released += updatedThisPass;
    if (updatedThisPass === 0 || rows.length < BATCH) break;
  }
  return released;
}
