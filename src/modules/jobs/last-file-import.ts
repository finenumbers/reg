import type { AllowedActionCode } from "@/modules/actions/registry";
import { prisma } from "@/lib/db";
import { loadStreakBreakAt } from "@/modules/jobs/scheduler";
import { filePassHadCalls, resolveLoadAnchor } from "@/modules/traffic/load-age";

const FILE_PASS_DONE = ["success", "failed"] as const;

type ImportAction = Extract<AllowedActionCode, "cdr.import" | "smg.import">;

const filePassOr = [
  { meta: { path: ["fileCount"], gt: 0 } },
  { phonesParsed: { gt: 0 } },
  { changesCount: { gt: 0 } },
] as const;

function filePassWhere(actionCode: ImportAction) {
  return {
    actionCode,
    status: { in: [...FILE_PASS_DONE] },
    OR: [...filePassOr],
  };
}

/**
 * Clock anchor for the load counter.
 * A file with calls uses that job. An empty-file streak uses its first job.
 * A yellow file that ended red in this process starts a new streak.
 */
export async function findLastFileImport(
  actionCode: ImportAction,
): Promise<{ lastPassAt: string | null; hadCalls: boolean }> {
  const latest = await prisma.jobRun.findFirst({
    where: filePassWhere(actionCode),
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, finishedAt: true, phonesParsed: true, changesCount: true },
  });
  if (!latest?.finishedAt) return { lastPassAt: null, hadCalls: false };

  const hadCalls = filePassHadCalls(latest);
  let streakStart: number | null = null;
  if (!hadCalls) {
    const previousCalls = await prisma.jobRun.findFirst({
      where: {
        actionCode,
        status: { in: [...FILE_PASS_DONE] },
        startedAt: { lt: latest.startedAt },
        OR: [{ phonesParsed: { gt: 0 } }, { changesCount: { gt: 0 } }],
      },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const firstEmpty = await prisma.jobRun.findFirst({
      where: {
        ...filePassWhere(actionCode),
        ...(previousCalls ? { startedAt: { gt: previousCalls.startedAt } } : {}),
      },
      orderBy: { startedAt: "asc" },
      select: { finishedAt: true },
    });
    streakStart = (firstEmpty?.finishedAt ?? latest.finishedAt).getTime();
  }

  const anchor = resolveLoadAnchor({
    latest: { at: latest.finishedAt.getTime(), hadCalls },
    streakStart,
    breakAt: loadStreakBreakAt(actionCode === "cdr.import" ? "rtu" : "smg"),
  });
  if (!anchor) return { lastPassAt: null, hadCalls: false };
  return { lastPassAt: new Date(anchor.at).toISOString(), hadCalls: anchor.hadCalls };
}
