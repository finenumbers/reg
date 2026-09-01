import { Prisma } from "@/generated/prisma/client";
import {
  graceCutoffAt,
  liveCutoffAt,
  type MatchLane,
} from "@/modules/voipmonitor/lanes";

/** Shared open-queue predicate for pickNextHour / hasVoipmonitorWork. */
export function openQueueWhereSql(now: Date, lane?: MatchLane) {
  const graceCutoff = graceCutoffAt(now);
  const liveCutoff = liveCutoffAt(now);
  const lanePred =
    lane === "live"
      ? Prisma.sql`AND c."cdrAt" >= ${liveCutoff}`
      : lane === "archive"
        ? Prisma.sql`AND c."cdrAt" < ${liveCutoff}`
        : Prisma.sql``;
  return Prisma.sql`
    c."cdrAt" IS NOT NULL
      AND c."importedAt" <= ${graceCutoff}
      AND (
        l.cdr_record_id IS NULL
        OR (
          l.voipmonitor_url = ''
          AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= ${now})
        )
      )
      ${lanePred}
  `;
}
