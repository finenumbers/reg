import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";

/** Not a live mark. Losing every `@live` row must not run this delete again. */
export const JOURNAL_RESET_DEVICE = "@journal-reset";
export const JOURNAL_RESET_FILE = "@revision";

const DONE = { done: true };

function isDone(state: unknown): boolean {
  return (
    !!state &&
    typeof state === "object" &&
    !Array.isArray(state) &&
    (state as { done?: unknown }).done === true
  );
}

export async function isJournalResetDone(): Promise<boolean> {
  const row = await prisma.smgTraceCheckpoint.findUnique({
    where: {
      deviceIp_fileKey: {
        deviceIp: JOURNAL_RESET_DEVICE,
        fileKey: JOURNAL_RESET_FILE,
      },
    },
    select: { state: true },
  });
  return isDone(row?.state);
}

/**
 * One `DELETE FROM radius_calls`. Rows committed after the statement starts
 * survive. The flag is written only after that statement succeeds, so a
 * later release does not run it again. The Parking byte cursor is not moved.
 */
export async function resetRadiusJournalOnce(): Promise<boolean> {
  if (await isJournalResetDone()) return false;
  await prisma.$executeRaw(Prisma.sql`DELETE FROM radius_calls`);
  await prisma.smgTraceCheckpoint.upsert({
    where: {
      deviceIp_fileKey: {
        deviceIp: JOURNAL_RESET_DEVICE,
        fileKey: JOURNAL_RESET_FILE,
      },
    },
    create: {
      deviceIp: JOURNAL_RESET_DEVICE,
      fileKey: JOURNAL_RESET_FILE,
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state: DONE,
    },
    update: {
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state: DONE,
    },
  });
  return true;
}
