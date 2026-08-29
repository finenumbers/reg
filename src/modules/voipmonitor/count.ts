import { prisma } from "@/lib/db";
import { QUEUE_EXHAUSTED_AT } from "@/modules/voipmonitor/constants";
import {
  graceCutoffAt,
  liveCutoffAt,
  type MatchLane,
} from "@/modules/voipmonitor/lanes";
import { voipmonitorDueLinkWhere } from "@/modules/voipmonitor/queue-filter";

function openCdrWhere(
  now: Date,
  linkWhere: object,
  lane?: MatchLane,
) {
  const graceCutoff = graceCutoffAt(now);
  const liveCutoff = liveCutoffAt(now);
  const cdrAt =
    lane === "live"
      ? { gte: liveCutoff }
      : lane === "archive"
        ? { lt: liveCutoff }
        : {};
  return {
    importedAt: { lte: graceCutoff },
    ...(Object.keys(cdrAt).length > 0 ? { cdrAt } : {}),
    OR: [
      { voipmonitorLink: { is: null } },
      { voipmonitorLink: { is: linkWhere } },
    ],
  };
}

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
  const open = await prisma.cdrRecord.findFirst({
    where: openCdrWhere(now, voipmonitorDueLinkWhere(now), lane),
    select: { id: true },
  });
  return open != null;
}
