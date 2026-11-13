/**
 * Replace one SipOut slice after the draft is complete.
 * The database transaction stays closed while SipOut is read.
 */

import { prisma } from "@/lib/db";
import { SyncLost } from "@/modules/numbering-sync/errors";
import {
  APPLY_TX,
  SIPOUT_PROVIDER,
  STAGE_BATCH,
  publishInsertSql,
  stageInsertSql,
  type SyncCatalog,
} from "@/modules/numbering-sync/sql";

export async function stageNumbers(
  runId: string,
  catalog: SyncCatalog,
  dids: readonly string[],
): Promise<void> {
  for (let index = 0; index < dids.length; index += STAGE_BATCH) {
    const slice = dids.slice(index, index + STAGE_BATCH);
    if (slice.length === 0) continue;
    await prisma.$executeRaw(stageInsertSql(runId, catalog, slice));
  }
}

export async function dropStage(runId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM numbering_sync_stage WHERE run_id = ${runId}
  `;
}

export async function publishCatalog(
  runId: string,
  catalog: SyncCatalog,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const held = await tx.$queryRaw<{ run_id: string }[]>`
      UPDATE numbering_sync_state
      SET phase = 'publishing', heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `;
    if (held.length !== 1) throw new SyncLost();
    const counted = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM numbering_sync_stage
      WHERE run_id = ${runId} AND catalog = ${catalog}
    `;
    const count = counted[0]?.count ?? 0;
    if (catalog === "free") {
      await tx.$executeRaw`DELETE FROM free_numbers WHERE provider = ${SIPOUT_PROVIDER}`;
      await tx.$executeRaw(publishInsertSql("free", runId));
    } else {
      await tx.$executeRaw`DELETE FROM purchased_numbers WHERE provider = ${SIPOUT_PROVIDER}`;
      await tx.$executeRaw(publishInsertSql("purchased", runId));
    }
    await tx.$executeRaw`DELETE FROM numbering_sync_stage WHERE run_id = ${runId}`;
    await tx.$executeRaw`
      UPDATE numbering_sync_state
      SET run_id = NULL,
          catalog = NULL,
          phase = '',
          cities_done = 0,
          cities_total = 0,
          error = NULL,
          heartbeat_at = NULL,
          last_catalog = ${catalog},
          last_error = NULL,
          last_written = ${count},
          last_finished_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId}
    `;
    return count;
  }, APPLY_TX);
}
