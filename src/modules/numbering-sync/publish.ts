/**
 * Fill the draft, then replace both SipOut catalogs on a connection
 * that is not taken from the application pool.
 */

import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { clearFreePstnExcludedSql } from "@/modules/numbering-catalog/free-pstn-excluded";
import { publishOneSide, PublishMismatch, type SideWrite } from "@/modules/numbering-sync/one-side";
import { catalogEpochSql } from "@/modules/numbering-catalog/decorate";
import {
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  STAGE_BATCH,
  fillSplitSql,
  stageInsertSql,
  type StagedNumber,
  type SyncCatalog,
} from "@/modules/numbering-sync/sql";

export type PublishCounts = SideWrite;

export { PublishMismatch };

export async function stageNumbers(
  runId: string,
  catalog: SyncCatalog,
  rows: readonly StagedNumber[],
): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += STAGE_BATCH) {
    const slice = rows.slice(index, index + STAGE_BATCH);
    if (slice.length === 0) continue;
    const count = await withDbRetry(() =>
      prisma.$executeRaw(stageInsertSql(runId, catalog, slice)),
    );
    inserted += count;
  }
  return inserted;
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM numbering_sync_stage WHERE run_id = ${runId}
    `,
  );
}

export async function dropForeignStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM numbering_sync_stage WHERE run_id <> ${runId}
    `,
  );
}

export async function fillDraftSplit(
  runId: string,
  beat: () => Promise<void>,
): Promise<void> {
  for (;;) {
    const updated = await withDbRetry(() =>
      prisma.$executeRaw(fillSplitSql(runId, SPLIT_BATCH)),
    );
    if (updated === 0) {
      const left = await withDbRetry(
        () => prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM numbering_sync_stage
          WHERE run_id = ${runId} AND ready = false
        `,
      );
      if ((left[0]?.count ?? 0) > 0) throw new Error("Не удалось рассчитать номера.");
      return;
    }
    await beat();
  }
}

export async function draftSummary(runId: string): Promise<{
  free: number;
  purchased: number;
  overlap: number;
}> {
  const rows = await withDbRetry(
    () => prisma.$queryRaw<{ free: number; purchased: number; overlap: number }[]>`
      SELECT
        (
          SELECT count(*)::int
          FROM numbering_sync_stage
          WHERE run_id = ${runId} AND catalog = 'free'
        ) AS free,
        (
          SELECT count(*)::int
          FROM numbering_sync_stage
          WHERE run_id = ${runId} AND catalog = 'purchased'
        ) AS purchased,
        (
          SELECT count(*)::int FROM (
            SELECT e164 FROM numbering_sync_stage
            WHERE run_id = ${runId} AND catalog = 'free'
            INTERSECT
            SELECT e164 FROM numbering_sync_stage
            WHERE run_id = ${runId} AND catalog = 'purchased'
          ) AS shared
        ) AS overlap
    `,
  );
  return rows[0] ?? { free: 0, purchased: 0, overlap: 0 };
}

/** Visible to the screen before the catalog locks are taken. */
export async function markPublishing(runId: string): Promise<boolean> {
  const rows = await withDbRetry(
    () => prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE numbering_sync_state
      SET phase = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

const LOCK_SQL = `SELECT run_id
       FROM numbering_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`;

const CLEAR_STAGE_SQL = `DELETE FROM numbering_sync_stage WHERE run_id = $1`;

const DELETE_SIPOUT_PURCHASED_SQL = `DELETE FROM purchased_numbers WHERE provider = 'SipOut'`;

const DELETE_SIPOUT_FREE_SQL = `DELETE FROM free_numbers WHERE provider = 'SipOut'`;

const FINISH_PURCHASED_SQL = `UPDATE numbering_sync_state
       SET run_id = NULL,
           catalog = NULL,
           phase = '',
           cities_done = 0,
           cities_total = 0,
           error = NULL,
           heartbeat_at = NULL,
           last_catalog = 'sipout',
           last_error = NULL,
           last_purchased_written = $2,
           purchased_loaded_at = CURRENT_TIMESTAMP,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`;

const FINISH_FREE_SQL = `UPDATE numbering_sync_state
       SET run_id = NULL,
           catalog = NULL,
           phase = '',
           cities_done = 0,
           cities_total = 0,
           error = NULL,
           heartbeat_at = NULL,
           last_catalog = 'sipout',
           last_error = NULL,
           last_free_written = $2,
           free_loaded_at = CURRENT_TIMESTAMP,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`;

/** One transaction. Deletes and inserts only SipOut purchased rows. */
export function replaceSipoutPurchased(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: STAGED_COUNT_SQL,
    countParams: [runId, "purchased"],
    deleteSql: DELETE_SIPOUT_PURCHASED_SQL,
    copySql: PURCHASED_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: FINISH_PURCHASED_SQL,
    epochSql: catalogEpochSql("sipout", "purchased"),
  });
}

/** One transaction. Deletes and inserts only SipOut free rows. */
export function replaceSipoutFree(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: STAGED_COUNT_SQL,
    countParams: [runId, "free"],
    deleteSql: DELETE_SIPOUT_FREE_SQL,
    clearExcludedSql: clearFreePstnExcludedSql("SipOut"),
    copySql: FREE_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: FINISH_FREE_SQL,
    epochSql: catalogEpochSql("sipout", "free"),
  });
}
