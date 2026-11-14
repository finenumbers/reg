/**
 * Stage pages, then replace every Runexis free number in one transaction.
 * purchased_numbers is not touched.
 */

import pg from "pg";
import { prisma } from "@/lib/db";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import {
  DELETE_RUNEXIS_FREE_SQL,
  FREE_COPY_SQL,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  decidePublish,
  fillSplitSql,
  stageInsertSql,
} from "@/modules/runexis/sql";

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
    /runexis_sync_stage_pkey/i.test(text)
  );
}

export async function stageNumbers(
  runId: string,
  dids: readonly string[],
): Promise<number> {
  if (dids.length === 0) return 0;
  try {
    const count = await withDbRetry(() =>
      prisma.$executeRaw(stageInsertSql(runId, dids)),
    );
    if (count !== dids.length) throw new Error("В ответе повторяется номер.");
    return count;
  } catch (error) {
    if (duplicateNumber(error)) throw new Error("В ответе повторяется номер.");
    throw error;
  }
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

/** One transaction. Deletes and inserts only provider Runexis in free_numbers. */
export async function replaceRunexisFree(runId: string): Promise<{ inserted: number }> {
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
       FROM runexis_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`,
      [runId],
    );
    const staged = await client.query<{ count: number }>(STAGED_COUNT_SQL, [runId]);
    const stagedCount = staged.rows[0]?.count ?? 0;
    await client.query(DELETE_RUNEXIS_FREE_SQL);
    const inserted = (await client.query(FREE_COPY_SQL, [runId])).rowCount ?? 0;
    const decision = decidePublish({
      held: held.rows.length === 1,
      staged: stagedCount,
      inserted,
    });
    if (decision !== "commit") {
      throw held.rows.length === 1 ? new PublishMismatch() : new SyncLost();
    }
    await client.query(`DELETE FROM runexis_sync_stage WHERE run_id = $1`, [runId]);
    const finished = await client.query(
      `UPDATE runexis_sync_state
       SET run_id = NULL,
           phase = '',
           page_done = 0,
           page_total = 0,
           error = NULL,
           heartbeat_at = NULL,
           last_error = NULL,
           last_free_written = $2,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`,
      [runId, inserted],
    );
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    await client.query("COMMIT");
    committed = true;
    try {
      noteCatalogReplaced();
    } catch {
      /* The catalogs are already replaced. The export generation catches up. */
    }
    return { inserted };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
