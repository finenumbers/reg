/**
 * An MCN Telecom walk dies with the process. Startup drops this lease and this draft.
 * Catalog rows are left as the last committed snapshot.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resetMcnProcess } from "@/modules/mcn/lease";

export const RECLAIM_STATE_SQL = `
  UPDATE mcn_sync_state
  SET run_id = NULL,
      phase = '',
      list = '',
      page_done = 0,
      page_total = 0,
      error = NULL,
      heartbeat_at = NULL
  WHERE id = 1 AND phase IN ('running', 'publishing')
`;

export const RECLAIM_STAGE_SQL = `DELETE FROM mcn_sync_stage`;

export async function reclaimMcnLease(): Promise<void> {
  resetMcnProcess();
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STATE_SQL));
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STAGE_SQL));
}
