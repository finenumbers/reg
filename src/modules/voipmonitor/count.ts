import { prisma } from "@/lib/db";
import {
  graceCutoffAt,
  liveCutoffAt,
  type MatchLane,
} from "@/modules/voipmonitor/lanes";
import {
  voipmonitorDueLinkWhere,
  voipmonitorPendingLinkWhere,
} from "@/modules/voipmonitor/queue-filter";

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

/** Empty URL still in the match queue (backoff included; exhausted "not found" excluded). */
export async function countUnenrichedVoipmonitor(
  now = new Date(),
): Promise<number> {
  return prisma.cdrRecord.count({
    where: openCdrWhere(now, voipmonitorPendingLinkWhere()),
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
