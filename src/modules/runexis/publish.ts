/**
 * Stage one list, then replace that Runexis slice.
 * One transaction. The other catalog stays.
 */

import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { catalogEpochSql } from "@/modules/numbering-catalog/decorate";
import { clearFreePstnExcludedSql } from "@/modules/numbering-catalog/free-pstn-excluded";
import { publishOneSide, type SideWrite } from "@/modules/numbering-sync/one-side";

export { PublishMismatch } from "@/modules/numbering-sync/one-side";
import type { FreeDraft } from "@/modules/runexis/parse";
import {
  DELETE_RUNEXIS_FREE_SQL,
  DELETE_RUNEXIS_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  fillSplitSql,
  stageFreeSql,
  stagePurchasedSql,
} from "@/modules/runexis/sql";

export class SyncLost extends Error {
  constructor() {
    super("Загрузка прервана. Каталог не изменён.");
    this.name = "SyncLost";
  }
}

function duplicateNumber(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const text = error instanceof Error ? error.message : String(error);
  return (
    code === "P2002" ||
    text.includes("23505") ||
    /unique constraint/i.test(text) ||
    /runexis_sync_stage_pkey/i.test(text)
  );
}

async function stage(count: number, write: () => Promise<number>): Promise<number> {
  if (count === 0) return 0;
  try {
    const inserted = await withDbRetry(write);
    if (inserted !== count) throw new Error("В ответе повторяется номер.");
    return inserted;
  } catch (error) {
    if (duplicateNumber(error)) throw new Error("В ответе повторяется номер.");
    throw error;
  }
}

/** A repeated e164 from another code is skipped. A real database error still fails the walk. */
export async function stageFreeNumbers(
  runId: string,
  rows: readonly FreeDraft[],
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    return await withDbRetry(() => prisma.$executeRaw(stageFreeSql(runId, rows)));
  } catch (error) {
    if (duplicateNumber(error)) throw new Error("В ответе повторяется номер.");
    throw error;
  }
}

export async function stagePurchasedNumbers(
  runId: string,
  rows: readonly FreeDraft[],
): Promise<number> {
  return stage(rows.length, () => prisma.$executeRaw(stagePurchasedSql(runId, rows)));
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM runexis_sync_stage WHERE run_id = ${runId}
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
          FROM runexis_sync_stage
          WHERE run_id = ${runId} AND ready = false
        `,
      );
      if ((left[0]?.count ?? 0) > 0) throw new Error("Не удалось рассчитать номера.");
      return;
    }
    await beat();
  }
}

export async function markPublishing(runId: string): Promise<boolean> {
  const rows = await withDbRetry(
    () => prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE runexis_sync_state
      SET phase = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

const SIDE_COUNT_SQL = `
  SELECT count(*)::int AS count
  FROM runexis_sync_stage
  WHERE run_id = $1 AND catalog = $2 AND ready = true
`;

const LOCK_SQL = `SELECT run_id
       FROM runexis_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`;

const CLEAR_STAGE_SQL = `DELETE FROM runexis_sync_stage WHERE run_id = $1`;

function finishSql(
  column: "last_purchased_written" | "last_free_written",
  stamp: "purchased_loaded_at" | "free_loaded_at",
): string {
  return `UPDATE runexis_sync_state
       SET run_id = NULL,
           phase = '',
           list = '',
           page_done = 0,
           page_total = 0,
           error = NULL,
           heartbeat_at = NULL,
           last_error = NULL,
           ${column} = $2,
           ${stamp} = CURRENT_TIMESTAMP,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`;
}

/** One transaction. Deletes and inserts only Runexis purchased rows. */
export function replaceRunexisPurchased(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: SIDE_COUNT_SQL,
    countParams: [runId, "purchased"],
    deleteSql: DELETE_RUNEXIS_PURCHASED_SQL,
    copySql: PURCHASED_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_purchased_written", "purchased_loaded_at"),
    epochSql: catalogEpochSql("runexis", "purchased"),
  });
}

/** One transaction. Deletes and inserts only Runexis free rows. */
export function replaceRunexisFree(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: SIDE_COUNT_SQL,
    countParams: [runId, "free"],
    deleteSql: DELETE_RUNEXIS_FREE_SQL,
    clearExcludedSql: clearFreePstnExcludedSql("Runexis"),
    copySql: FREE_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_free_written", "free_loaded_at"),
    epochSql: catalogEpochSql("runexis", "free"),
  });
}
