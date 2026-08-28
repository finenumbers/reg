import { prisma } from "@/lib/db";

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

export async function hasVoipmonitorWork(now = new Date()): Promise<boolean> {
  const graceCutoff = new Date(now.getTime() - 15_000);
  const open = await prisma.cdrRecord.findFirst({
    where: {
      cdrAt: { lte: graceCutoff },
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
