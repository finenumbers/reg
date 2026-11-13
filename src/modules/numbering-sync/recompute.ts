/**
 * After a tariff file is committed, refresh ABC, the local number, city, and region.
 * SipOut is not called. A live walk keeps its lease; this waits and tries again.
 */

import { prisma } from "@/lib/db";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { APPLY_TX, recomputeSql } from "@/modules/numbering-sync/sql";

const ATTEMPTS = 3;
const RETRY_MS = 2_000;

async function recomputeOnce(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ run_id: string | null; fresh: boolean }[]>`
      SELECT run_id,
        (
          heartbeat_at IS NOT NULL
          AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
        ) AS fresh
      FROM numbering_sync_state
      WHERE id = 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (row?.run_id && row.fresh) throw new SyncBusy();
    await tx.$executeRaw(recomputeSql("free_numbers"));
    await tx.$executeRaw(recomputeSql("purchased_numbers"));
  }, APPLY_TX);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Three tries. A failure does not roll back the tariff snapshot. */
export function requestNumberingResplit(): void {
  void (async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        await recomputeOnce();
        return;
      } catch {
        if (attempt + 1 < ATTEMPTS) await wait(RETRY_MS);
      }
    }
  })();
}
