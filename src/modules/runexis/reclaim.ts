/**
 * A Runexis walk dies with the process. Startup drops this lease and this draft.
 * Catalog rows are left as the last committed snapshot.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resetRunexisProcess } from "@/modules/runexis/lease";

export const RECLAIM_STATE_SQL = `
  UPDATE runexis_sync_state
  SET run_id = NULL,
      phase = '',
      page_done = 0,
      page_total = 0,
      error = NULL,
      heartbeat_at = NULL
  WHERE id = 1 AND phase IN ('running', 'publishing')
`;

export const RECLAIM_STAGE_SQL = `DELETE FROM runexis_sync_stage`;

export async function reclaimRunexisLease(): Promise<void> {
  resetRunexisProcess();
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STATE_SQL));
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STAGE_SQL));
}
