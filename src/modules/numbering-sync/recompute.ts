/**
 * After a tariff file is committed, refresh ABC, the local number, city, and region.
 * No numbering source is called. A live walk keeps its lease; this waits and tries again.
 * SipOut is locked before Runexis, then UIS, then Aurora Telecom, then MTS Exolve, so a publish that already holds one lease cannot deadlock.
 */

import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { isLockTimeout, resplitShouldWait } from "@/modules/numbering-sync/db-retry";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { APPLY_TX, recomputeSql } from "@/modules/numbering-sync/sql";
import {
  RESPLIT_LOCKS,
  RESPLIT_RUNEXIS_LOCK_SQL,
  RESPLIT_AURORA_LOCK_SQL,
  RESPLIT_EXOLVE_LOCK_SQL,
  RESPLIT_SIPOUT_LOCK_SQL,
  RESPLIT_UIS_LOCK_SQL,
} from "@/modules/numbering-sync/locks";

export {
  RESPLIT_AURORA_LOCK_SQL,
  RESPLIT_EXOLVE_LOCK_SQL,
  RESPLIT_LOCKS,
  RESPLIT_RUNEXIS_LOCK_SQL,
  RESPLIT_SIPOUT_LOCK_SQL,
  RESPLIT_UIS_LOCK_SQL,
};

const RETRY_MS = 5_000;

async function recomputeOnce(): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const sql of RESPLIT_LOCKS) {
        const rows = await tx.$queryRaw<{ run_id: string | null; fresh: boolean }[]>(
          Prisma.raw(sql),
        );
        const row = rows[0];
        if (row?.run_id && row.fresh) throw new SyncBusy();
      }
      await tx.$executeRaw(recomputeSql("free_numbers"));
      await tx.$executeRaw(recomputeSql("purchased_numbers"));
    }, APPLY_TX);
  } catch (error) {
    if (error instanceof SyncBusy || isLockTimeout(error)) throw new SyncBusy();
    throw error;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait out a live numbering stage. A failure does not roll back the tariff snapshot. */
export function requestNumberingResplit(): void {
  void (async () => {
    const started = Date.now();
    let transientTries = 0;
    for (;;) {
      try {
        await recomputeOnce();
        return;
      } catch (error) {
        const elapsed = Date.now() - started;
        if (!resplitShouldWait(error, elapsed, transientTries)) {
          if (error instanceof SyncBusy) {
            logger.warn("numbering.resplit.gave_up", { waitedMs: elapsed });
          }
          return;
        }
        if (!(error instanceof SyncBusy)) transientTries += 1;
        await wait(RETRY_MS);
      }
    }
  })();
}
