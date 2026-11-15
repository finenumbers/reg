/**
 * Stage both lists, then replace every UIS row in both catalogs.
 * One transaction. Free numbers are written before purchased numbers.
 */

import pg from "pg";
import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import {
  UIS_EPOCH_SQL,
  requestDecorateCatchUp,
} from "@/modules/numbering-catalog/decorate";
import type { UisRow } from "@/modules/uis/parse";
import {
  DELETE_UIS_FREE_SQL,
  DELETE_UIS_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  decidePublish,
  dropOverlapSql,
  fillSplitSql,
  stageFreeSql,
  stagePurchasedSql,
} from "@/modules/uis/sql";

const STAGE_CHUNK = 500;

export class PublishMismatch extends Error {
  constructor() {
    super("Число номеров не сошлось. Каталог не изменён.");
    this.name = "PublishMismatch";
  }
}

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
    /uis_sync_stage_pkey/i.test(text)
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

async function stageChunks<T>(
  rows: readonly T[],
  write: (chunk: readonly T[]) => Promise<number>,
): Promise<void> {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += STAGE_CHUNK) {
    const chunk = rows.slice(index, index + STAGE_CHUNK);
    inserted += await stage(chunk.length, () => write(chunk));
  }
  if (inserted !== rows.length) throw new Error("В ответе повторяется номер.");
}

export async function stageFreeNumbers(
  runId: string,
  rows: readonly UisRow[],
): Promise<void> {
  await stageChunks(rows, (chunk) => prisma.$executeRaw(stageFreeSql(runId, chunk)));
}

export async function stagePurchasedNumbers(
  runId: string,
  dids: readonly string[],
): Promise<void> {
  await stageChunks(dids, (chunk) => prisma.$executeRaw(stagePurchasedSql(runId, chunk)));
}

/** Free rows that are already purchased in this run. They leave the free draft. */
export async function dropPurchasedOverlap(runId: string): Promise<number> {
  return withDbRetry(() => prisma.$executeRaw(dropOverlapSql(runId)));
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM uis_sync_stage WHERE run_id = ${runId}
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
          FROM uis_sync_stage
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
      UPDATE uis_sync_state
      SET phase = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

export type PublishedCounts = { free: number; purchased: number };

function stagedCount(
  rows: { catalog: string; count: number }[],
  catalog: string,
): number {
  return rows.find((row) => row.catalog === catalog)?.count ?? 0;
}

/** One transaction. Deletes and inserts only provider UIS in both catalogs. */
export async function replaceUisCatalogs(runId: string): Promise<PublishedCounts> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '600s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    const held = await client.query<{ run_id: string }>(
      `SELECT run_id
       FROM uis_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`,
      [runId],
    );
    const staged = await client.query<{ catalog: string; count: number }>(
      STAGED_COUNT_SQL,
      [runId],
    );
    await client.query(DELETE_UIS_FREE_SQL);
    const free = (await client.query(FREE_COPY_SQL, [runId])).rowCount ?? 0;
    await client.query(DELETE_UIS_PURCHASED_SQL);
    const purchased = (await client.query(PURCHASED_COPY_SQL, [runId])).rowCount ?? 0;
    const decision = decidePublish({
      held: held.rows.length === 1,
      stagedFree: stagedCount(staged.rows, "free"),
      insertedFree: free,
      stagedPurchased: stagedCount(staged.rows, "purchased"),
      insertedPurchased: purchased,
    });
    if (decision !== "commit") {
      throw held.rows.length === 1 ? new PublishMismatch() : new SyncLost();
    }
    await client.query(`DELETE FROM uis_sync_stage WHERE run_id = $1`, [runId]);
    const finished = await client.query(
      `UPDATE uis_sync_state
       SET run_id = NULL,
           phase = '',
           list = '',
           page_done = 0,
           page_total = 0,
           error = NULL,
           heartbeat_at = NULL,
           last_error = NULL,
           last_free_written = $2,
           last_purchased_written = $3,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`,
      [runId, free, purchased],
    );
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    const epoch = await client.query(UIS_EPOCH_SQL);
    if ((epoch.rowCount ?? 0) !== 1) throw new Error("Не удалось отметить каталог.");
    await client.query("COMMIT");
    committed = true;
    try {
      noteCatalogReplaced();
    } catch {
      /* The catalogs are already replaced. The export generation catches up. */
    }
    try {
      requestDecorateCatchUp();
    } catch {
      /* The epoch stays ahead. The next start fills the cells. */
    }
    return { free, purchased };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
