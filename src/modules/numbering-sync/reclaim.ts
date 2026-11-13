/**
 * A SipOut walk dies with the process. Startup drops the lease and the draft.
 * Catalog rows are left as the last committed snapshot.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resetNumberingSyncProcess } from "@/modules/numbering-sync/lease";

export const RECLAIM_STATE_SQL = `
  UPDATE numbering_sync_state
  SET run_id = NULL,
      catalog = NULL,
      phase = '',
      cities_done = 0,
      cities_total = 0,
      error = NULL,
      heartbeat_at = NULL
  WHERE id = 1 AND phase IN ('running', 'publishing')
`;

export const RECLAIM_STAGE_SQL = `DELETE FROM numbering_sync_stage`;

export async function reclaimNumberingSyncLease(): Promise<void> {
  resetNumberingSyncProcess();
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STATE_SQL));
  await prisma.$executeRaw(Prisma.raw(RECLAIM_STAGE_SQL));
}
