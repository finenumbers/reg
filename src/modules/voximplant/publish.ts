/**
 * Stage one list, then replace that Voximplant catalog.
 * A purchased duplicate fails the walk. A free duplicate from another
 * region keeps the first price. The other catalog is not deleted.
 */

import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { SyncLost as LeaseLost } from "@/modules/numbering-sync/errors";
import { publishOneSide, type SideWrite } from "@/modules/numbering-sync/one-side";
import { VOXIMPLANT_EPOCH_SQL } from "@/modules/numbering-catalog/decorate";
import { DUPLICATE_NUMBER, type FreeRow } from "@/modules/voximplant/parse";
import {
  DELETE_VOXIMPLANT_FREE_SQL,
  DELETE_VOXIMPLANT_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  dropPurchasedSql,
  existingSql,
  fillSplitSql,
  stageFreeSql,
  stagePurchasedSql,
} from "@/modules/voximplant/sql";

export { PublishMismatch } from "@/modules/numbering-sync/one-side";

const STAGE_CHUNK = 500;

const LOCK_SQL = `SELECT run_id
       FROM voximplant_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`;

const CLEAR_STAGE_SQL = `DELETE FROM voximplant_sync_stage WHERE run_id = $1`;

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
    /voximplant_sync_stage_pkey/i.test(text)
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
  rows: readonly FreeRow[],
  beat?: () => Promise<void>,
): Promise<void> {
  rejectDuplicates(rows.map((row) => row.e164));
  const existing = await findExisting(
    runId,
    "purchased",
    rows.map((row) => row.e164),
    beat,
  );
  if (existing.size > 0) throw new Error(DUPLICATE_NUMBER);
  await writeChunks(
    rows,
    (chunk) => prisma.$executeRaw(stagePurchasedSql(runId, chunk)),
    beat,
  );
}

export async function dropPurchasedStage(runId: string): Promise<void> {
  await withDbRetry(() => prisma.$executeRaw(dropPurchasedSql(runId)));
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM voximplant_sync_stage WHERE run_id = ${runId}
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
          FROM voximplant_sync_stage
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
      UPDATE voximplant_sync_state
      SET phase = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

function finishSql(
  column: "last_purchased_written" | "last_free_written",
  stamp: "purchased_loaded_at" | "free_loaded_at",
): string {
  return `UPDATE voximplant_sync_state
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

async function publishSide(input: Parameters<typeof publishOneSide>[0]): Promise<SideWrite> {
  try {
    return await publishOneSide(input);
  } catch (error) {
    if (error instanceof LeaseLost) throw new SyncLost();
    throw error;
  }
}

/** One transaction. Deletes and inserts only Voximplant purchased rows. */
export function replaceVoximplantPurchased(runId: string): Promise<SideWrite> {
  return publishSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: STAGED_COUNT_SQL,
    countParams: [runId, "purchased"],
    deleteSql: DELETE_VOXIMPLANT_PURCHASED_SQL,
    copySql: PURCHASED_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_purchased_written", "purchased_loaded_at"),
    epochSql: VOXIMPLANT_EPOCH_SQL,
  });
}

/** One transaction. Deletes and inserts only Voximplant free rows. */
export function replaceVoximplantFree(runId: string): Promise<SideWrite> {
  return publishSide({
    runId,
    lockSql: LOCK_SQL,
    countSql: STAGED_COUNT_SQL,
    countParams: [runId, "free"],
    deleteSql: DELETE_VOXIMPLANT_FREE_SQL,
    copySql: FREE_COPY_SQL,
    clearStageSql: CLEAR_STAGE_SQL,
    finishSql: finishSql("last_free_written", "free_loaded_at"),
    epochSql: VOXIMPLANT_EPOCH_SQL,
  });
}
