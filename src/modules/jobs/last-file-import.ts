import type { AllowedActionCode } from "@/modules/actions/registry";
import { prisma } from "@/lib/db";
import { filePassHadCalls } from "@/modules/traffic/load-age";

const FILE_PASS_DONE = ["success", "failed"] as const;

/**
 * Latest finished import that took a file.
 * `meta.fileCount` covers a normal finish, including an empty file.
 * Column counts cover a thrown finish that wrote rows but left meta at "started".
 */
export async function findLastFileImport(
  actionCode: Extract<AllowedActionCode, "cdr.import" | "smg.import">,
): Promise<{ lastPassAt: string | null; hadCalls: boolean }> {
  const row = await prisma.jobRun.findFirst({
    where: {
      actionCode,
      status: { in: [...FILE_PASS_DONE] },
      OR: [
        { meta: { path: ["fileCount"], gt: 0 } },
        { phonesParsed: { gt: 0 } },
        { changesCount: { gt: 0 } },
      ],
    },
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true, phonesParsed: true, changesCount: true },
  });
  if (!row?.finishedAt) return { lastPassAt: null, hadCalls: false };
  return {
    lastPassAt: row.finishedAt.toISOString(),
    hadCalls: filePassHadCalls(row),
  };
}
