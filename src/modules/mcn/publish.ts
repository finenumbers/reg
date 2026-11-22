/**
 * Stage one list, then replace that MCN Telecom slice.
 * One transaction. The other catalog stays.
 */

import { prisma } from "@/lib/db";
import { catalogEpochSql } from "@/modules/numbering-catalog/decorate";
import { clearFreePstnExcludedSql } from "@/modules/numbering-catalog/free-pstn-excluded";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { publishOneSide, type SideWrite } from "@/modules/numbering-sync/one-side";
import { DUPLICATE_NUMBER, type FreeRow } from "@/modules/mcn/parse";
import {
  DELETE_MCN_FREE_SQL,
  DELETE_MCN_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  existingSql,
  fillSplitSql,
  stageFreeSql,
  stagePurchasedSql,
} from "@/modules/mcn/sql";

export { PublishMismatch } from "@/modules/numbering-sync/one-side";

const STAGE_CHUNK = 500;

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
    /mcn_sync_stage_pkey/i.test(text)
  );
}

function rejectDuplicates(dids: readonly string[]): void {
  const seen = new Set<string>();
  for (const did of dids) {
    if (seen.has(did)) throw new Error(DUPLICATE_NUMBER);
    seen.add(did);
  }
}

async function findExisting(
  runId: string,
  catalog: "free" | "purchased",
  dids: readonly string[],
  beat?: () => Promise<void>,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let index = 0; index < dids.length; index += STAGE_CHUNK) {
    const chunk = dids.slice(index, index + STAGE_CHUNK);
    const rows = await withDbRetry(() =>
      prisma.$queryRaw<{ e164: string }[]>(existingSql(runId, catalog, chunk)),
    );
    for (const row of rows) found.add(row.e164);
    if (beat && index + STAGE_CHUNK < dids.length) await beat();
  }
  return found;
}

async function writeChunks<T>(
  rows: readonly T[],
  write: (chunk: readonly T[]) => Promise<number>,
  beat?: () => Promise<void>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let index = 0; index < rows.length; index += STAGE_CHUNK) {
    const chunk = rows.slice(index, index + STAGE_CHUNK);
    let wrote: number;
    try {
      wrote = await withDbRetry(() => write(chunk));
    } catch (error) {
      if (duplicateNumber(error)) throw new Error(DUPLICATE_NUMBER);
      throw error;
    }
    inserted += wrote;
    if (beat && index + STAGE_CHUNK < rows.length) await beat();
  }
  return inserted;
}

export async function stageFreeNumbers(
  runId: string,
  rows: readonly FreeRow[],
  beat?: () => Promise<void>,
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  rejectDuplicates(rows.map((row) => row.e164));
  const existing = await findExisting(
    runId,
    "free",
    rows.map((row) => row.e164),
    beat,
  );
  const fresh = rows.filter((row) => !existing.has(row.e164));
  const inserted = await writeChunks(
    fresh,
    (chunk) => prisma.$executeRaw(stageFreeSql(runId, chunk)),
    beat,
  );
  return { inserted, skipped: rows.length - fresh.length };
}

export async function stagePurchasedNumbers(
  runId: string,
  dids: readonly string[],
  beat?: () => Promise<void>,
): Promise<void> {
  if (dids.length === 0) return;
  rejectDuplicates(dids);
  const existing = await findExisting(runId, "purchased", dids, beat);
  if (existing.size > 0) throw new Error(DUPLICATE_NUMBER);
  await writeChunks(
    dids,
    (chunk) => prisma.$executeRaw(stagePurchasedSql(runId, chunk)),
    beat,
  );
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM mcn_sync_stage WHERE run_id = ${runId}
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
          FROM mcn_sync_stage
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
      UPDATE mcn_sync_state
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
  FROM mcn_sync_stage
  WHERE run_id = $1 AND catalog = $2 AND ready = true
`;

const LOCK_SQL = `SELECT run_id
       FROM mcn_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`;

const CLEAR_STAGE_SQL = `DELETE FROM mcn_sync_stage WHERE run_id = $1`;

function finishSql(
  column: "last_purchased_written" | "last_free_written",
  stamp: "purchased_loaded_at" | "free_loaded_at",
): string {
  return `UPDATE mcn_sync_state
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

/** One transaction. Deletes and inserts only MCN Telecom purchased rows. */
export function replaceMcnPurchased(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: SIDE_COUNT_SQL,
    countParams: [runId, "purchased"],
    deleteSql: DELETE_MCN_PURCHASED_SQL,
    copySql: PURCHASED_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_purchased_written", "purchased_loaded_at"),
    epochSql: catalogEpochSql("mcn", "purchased"),
  });
}

/** One transaction. Deletes and inserts only MCN Telecom free rows. */
export function replaceMcnFree(runId: string): Promise<SideWrite> {
  return publishOneSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: SIDE_COUNT_SQL,
    countParams: [runId, "free"],
    deleteSql: DELETE_MCN_FREE_SQL,
    clearExcludedSql: clearFreePstnExcludedSql("MCN Telecom"),
    copySql: FREE_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_free_written", "free_loaded_at"),
    epochSql: catalogEpochSql("mcn", "free"),
  });
}
