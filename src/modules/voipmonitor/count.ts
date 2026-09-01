import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withTransientRetry } from "@/lib/prisma-transient";
import { QUEUE_EXHAUSTED_AT } from "@/modules/voipmonitor/constants";
import { type MatchLane } from "@/modules/voipmonitor/lanes";
import { openQueueWhereSql } from "@/modules/voipmonitor/open-queue-sql";

/** CDR rows that still have no confirmed VoIPmonitor URL (cheap: two counts). */
export async function countUnenrichedVoipmonitor(): Promise<number> {
  const [total, withUrl] = await Promise.all([
    prisma.cdrRecord.count(),
    prisma.cdrVoipmonitorLink.count({
      where: { voipmonitorUrl: { not: "" } },
    }),
  ]);
  return Math.max(0, total - withUrl);
}

/** Exhausted not-found: empty URL and sentinel next_attempt_at. Cheap link-table count. */
export function voipmonitorParkedLinkWhere() {
  return {
    voipmonitorUrl: "",
    nextAttemptAt: { gte: QUEUE_EXHAUSTED_AT },
  };
}

export async function countParkedVoipmonitor(): Promise<number> {
  return prisma.cdrVoipmonitorLink.count({
    where: voipmonitorParkedLinkWhere(),
  });
}

export async function hasVoipmonitorWork(
  now = new Date(),
  lane?: MatchLane,
): Promise<boolean> {
  return withTransientRetry(async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
      SELECT 1 AS ok
      FROM cdr_records c
      LEFT JOIN cdr_voipmonitor_links l ON l.cdr_record_id = c.id
      WHERE ${openQueueWhereSql(now, lane)}
      LIMIT 1
    `);
    return rows.length > 0;
  });
}
