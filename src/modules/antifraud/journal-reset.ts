import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";

/** Not a live mark. Losing every `@live` row must not run this delete again. */
export const JOURNAL_RESET_DEVICE = "@journal-reset";
export const JOURNAL_RESET_FILE = "@revision";

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
 * One statement deletes `radius_calls` and writes the done flag.
 * Rows committed after that statement starts survive. A crash cannot
 * delete the journal a second time. The Parking byte cursor is not moved.
 */
export async function resetRadiusJournalOnce(): Promise<boolean> {
  if (await isJournalResetDone()) return false;
  await prisma.$executeRaw(Prisma.sql`
    WITH wiped AS (
      DELETE FROM radius_calls RETURNING 1
    )
    INSERT INTO smg_trace_checkpoints (id, device_ip, file_key, size, version, state)
    SELECT
      'journal_reset',
      ${JOURNAL_RESET_DEVICE},
      ${JOURNAL_RESET_FILE},
      0,
      ${SMG_TRACE_PARSER_VERSION},
      '{"done":true}'::jsonb
    WHERE (SELECT COUNT(*) FROM wiped) >= 0
    ON CONFLICT (device_ip, file_key) DO UPDATE
    SET size = EXCLUDED.size,
        version = EXCLUDED.version,
        state = EXCLUDED.state
  `);
  return true;
}
