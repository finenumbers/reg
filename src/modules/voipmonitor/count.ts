import { prisma } from "@/lib/db";
import {
  graceCutoffAt,
  liveCutoffAt,
  type MatchLane,
} from "@/modules/voipmonitor/lanes";

/** CDR rows that still have no confirmed VoIPmonitor URL. */
export async function countUnenrichedVoipmonitor(): Promise<number> {
  const [total, withUrl] = await Promise.all([
    prisma.cdrRecord.count(),
    prisma.cdrVoipmonitorLink.count({
      where: { voipmonitorUrl: { not: "" } },
    }),
  ]);
  return Math.max(0, total - withUrl);
}

export async function hasVoipmonitorWork(
  now = new Date(),
  lane?: MatchLane,
): Promise<boolean> {
  const graceCutoff = graceCutoffAt(now);
  const liveCutoff = liveCutoffAt(now);
  const cdrAt =
    lane === "live"
      ? { gte: liveCutoff }
      : lane === "archive"
        ? { lt: liveCutoff }
        : {};
  const open = await prisma.cdrRecord.findFirst({
    where: {
      importedAt: { lte: graceCutoff },
      ...(Object.keys(cdrAt).length > 0 ? { cdrAt } : {}),
      OR: [
        { voipmonitorLink: { is: null } },
        {
          voipmonitorLink: {
            is: {
              voipmonitorUrl: "",
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  return open != null;
}
