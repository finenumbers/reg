/**
 * Stage both lists, then replace every MCN Telecom row in both catalogs.
 * One transaction. A purchased duplicate fails the walk. A free duplicate
 * from another country keeps the first price.
 */

import pg from "pg";
import { prisma } from "@/lib/db";
import { safeDropped } from "@/modules/numbering-sync/card-numbers";
import {
  MCN_EPOCH_SQL,
  requestDecorateCatchUp,
} from "@/modules/numbering-catalog/decorate";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import { isMcnStopping } from "@/modules/mcn/lease";
import { DUPLICATE_NUMBER, type FreeRow } from "@/modules/mcn/parse";
import {
  DELETE_MCN_FREE_SQL,
  DELETE_MCN_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  decidePublish,
  dropOverlapSql,
  existingSql,
  fillSplitSql,
  stageFreeSql,
  stagePurchasedSql,
} from "@/modules/mcn/sql";

const STAGE_CHUNK = 500;
const CANCELLED = "Загрузка отменена. Каталог не изменён.";

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

export async function dropPurchasedOverlap(runId: string): Promise<number> {
  return withDbRetry(() => prisma.$executeRaw(dropOverlapSql(runId)));
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

export type PublishedCounts = { free: number; purchased: number };

function stagedCount(
  rows: { catalog: string; count: number }[],
  catalog: string,
): number {
  return rows.find((row) => row.catalog === catalog)?.count ?? 0;
}

/** One transaction. Deletes and inserts only provider MCN Telecom in both catalogs. */
export async function replaceMcnCatalogs(
  runId: string,
  duplicates: number,
): Promise<PublishedCounts> {
  if (isMcnStopping()) throw new Error(CANCELLED);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let committed = false;
  try {
    if (isMcnStopping()) throw new Error(CANCELLED);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '600s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    const held = await client.query<{ run_id: string }>(
      `SELECT run_id
       FROM mcn_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`,
      [runId],
    );
    const staged = await client.query<{ catalog: string; count: number }>(
      STAGED_COUNT_SQL,
      [runId],
    );
    await client.query(DELETE_MCN_FREE_SQL);
    const free = (await client.query(FREE_COPY_SQL, [runId])).rowCount ?? 0;
    await client.query(DELETE_MCN_PURCHASED_SQL);
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
    await client.query(`DELETE FROM mcn_sync_stage WHERE run_id = $1`, [runId]);
    const finished = await client.query(
      `UPDATE mcn_sync_state
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
           duplicates_dropped = $4,
           last_finished_at = CURRENT_TIMESTAMP,
           loaded_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`,
      [runId, free, purchased, safeDropped(duplicates)],
    );
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    const epoch = await client.query(MCN_EPOCH_SQL);
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
