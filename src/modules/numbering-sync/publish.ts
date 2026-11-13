/**
 * Fill the draft, then replace both SipOut catalogs on a connection
 * that is not taken from the application pool.
 */

import pg from "pg";

import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { SyncLost } from "@/modules/numbering-sync/errors";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import {
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  STAGE_BATCH,
  decidePublish,
  fillSplitSql,
  stageInsertSql,
  type SyncCatalog,
} from "@/modules/numbering-sync/sql";

export type PublishCounts = {
  deletedFree: number;
  insertedFree: number;
  deletedPurchased: number;
  insertedPurchased: number;
};

export class PublishMismatch extends Error {
  constructor() {
    super("Не удалось записать номера.");
    this.name = "PublishMismatch";
  }
}

export async function stageNumbers(
  runId: string,
  catalog: SyncCatalog,
  dids: readonly string[],
): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < dids.length; index += STAGE_BATCH) {
    const slice = dids.slice(index, index + STAGE_BATCH);
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
          catalog = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

async function stagedCount(
  client: pg.PoolClient | pg.Client,
  runId: string,
  catalog: SyncCatalog,
): Promise<number> {
  const result = await client.query<{ count: number }>(STAGED_COUNT_SQL, [runId, catalog]);
  return result.rows[0]?.count ?? 0;
}

/**
 * One transaction. The caller has already set phase to publishing.
 * A mismatch rolls the catalogs back to the previous SipOut rows.
 */
export async function replaceSipoutCatalogs(runId: string): Promise<PublishCounts> {
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
       FROM numbering_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`,
      [runId],
    );
    const stagedFree = await stagedCount(client, runId, "free");
    const stagedPurchased = await stagedCount(client, runId, "purchased");
    const deletedFree =
      (
        await client.query(`DELETE FROM free_numbers WHERE provider = 'SipOut'`)
      ).rowCount ?? 0;
    const insertedFree = (await client.query(FREE_COPY_SQL, [runId])).rowCount ?? 0;
    const deletedPurchased =
      (
        await client.query(`DELETE FROM purchased_numbers WHERE provider = 'SipOut'`)
      ).rowCount ?? 0;
    const insertedPurchased = (await client.query(PURCHASED_COPY_SQL, [runId])).rowCount ?? 0;
    const decision = decidePublish({
      held: held.rows.length === 1,
      stagedFree,
      insertedFree,
      stagedPurchased,
      insertedPurchased,
    });
    if (decision !== "commit") {
      throw held.rows.length === 1 ? new PublishMismatch() : new SyncLost();
    }
    await client.query(`DELETE FROM numbering_sync_stage WHERE run_id = $1`, [runId]);
    const finished = await client.query(
      `UPDATE numbering_sync_state
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
           last_purchased_written = $3,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`,
      [runId, insertedFree, insertedPurchased],
    );
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    await client.query("COMMIT");
    committed = true;
    noteCatalogReplaced();
    return { deletedFree, insertedFree, deletedPurchased, insertedPurchased };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
