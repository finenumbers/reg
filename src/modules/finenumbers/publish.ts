/**
 * Stage the expanded numbers, then replace only the Finenumbers slice.
 * The same number in both catalogs does not publish. Deletes are chunked.
 */

import pg from "pg";
import { prisma } from "@/lib/db";
import {
  catalogEpochSql,
  requestDecorateCatchUp,
} from "@/modules/numbering-catalog/decorate";
import { withDbRetry } from "@/modules/numbering-sync/db-retry";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import {
  catalogOf,
  EXPAND_CHUNK,
  expandSlice,
  sliceBounds,
  type ExpandedNumber,
} from "@/modules/finenumbers/expand";
import { isFinenumbersStopping } from "@/modules/finenumbers/lease";
import type { AcceptedRange } from "@/modules/finenumbers/walk";
import {
  DELETE_FREE_CHUNK_SQL,
  DELETE_PURCHASED_CHUNK_SQL,
  FREE_COPY_SQL,
  OVERLAP_SQL,
  PURCHASED_COPY_SQL,
  COPY_CHUNK,
  SPLIT_BATCH,
  STAGED_COUNT_SQL,
  decidePublish,
  existingSql,
  fillSplitSql,
  stageSql,
} from "@/modules/finenumbers/sql";

export const DUPLICATE_NUMBER = "В ответе повторяется номер.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const MISMATCH = "Число номеров не сошлось. Каталог не изменён.";

export class PublishMismatch extends Error {
  constructor() {
    super(MISMATCH);
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
    /finenumbers_sync_stage_pkey/i.test(text)
  );
}

function rejectDuplicates(rows: readonly ExpandedNumber[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.e164)) throw new Error(DUPLICATE_NUMBER);
    seen.add(row.e164);
  }
}

async function findExisting(runId: string, dids: readonly string[]): Promise<boolean> {
  if (dids.length === 0) return false;
  const rows = await withDbRetry(() =>
    prisma.$queryRaw<{ e164: string }[]>(existingSql(runId, dids)),
  );
  return rows.length > 0;
}

export async function stageExpanded(input: {
  runId: string;
  ranges: readonly AcceptedRange[];
  phoneKeys: ReadonlySet<string>;
  beat: () => Promise<void>;
}): Promise<void> {
  for (const range of input.ranges) {
    for (const slice of sliceBounds(range.rangeStart, range.rangeEnd, EXPAND_CHUNK)) {
      const rows = expandSlice(range, slice.from, slice.to).map((row) => ({
        ...row,
        catalog: catalogOf(row.e164, input.phoneKeys),
      }));
      rejectDuplicates(rows);
      if (await findExisting(input.runId, rows.map((row) => row.e164))) {
        throw new Error(DUPLICATE_NUMBER);
      }
      const free = rows.filter((row) => row.catalog === "free");
      const purchased = rows.filter((row) => row.catalog === "purchased");
      try {
        if (free.length > 0) {
          await withDbRetry(() => prisma.$executeRaw(stageSql(input.runId, "free", free)));
        }
        if (purchased.length > 0) {
          await withDbRetry(() =>
            prisma.$executeRaw(stageSql(input.runId, "purchased", purchased)),
          );
        }
      } catch (error) {
        if (duplicateNumber(error)) throw new Error(DUPLICATE_NUMBER);
        throw error;
      }
      await input.beat();
    }
  }
}

export async function dropStage(runId: string): Promise<void> {
  await withDbRetry(
    () => prisma.$executeRaw`
      DELETE FROM finenumbers_sync_stage WHERE run_id = ${runId}
    `,
  );
}

export async function fillDraftSplit(runId: string, beat: () => Promise<void>): Promise<void> {
  for (;;) {
    const updated = await withDbRetry(() =>
      prisma.$executeRaw(fillSplitSql(runId, SPLIT_BATCH)),
    );
    if (updated === 0) {
      const left = await withDbRetry(
        () => prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM finenumbers_sync_stage
          WHERE run_id = ${runId} AND ready = false
        `,
      );
      if ((left[0]?.count ?? 0) > 0) throw new Error(MISMATCH);
      return;
    }
    await beat();
  }
}

export async function markPublishing(runId: string): Promise<boolean> {
  const rows = await withDbRetry(
    () => prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE finenumbers_sync_state
      SET phase = 'publishing',
          heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING run_id
    `,
  );
  return rows.length === 1;
}

export type PublishedCounts = { free: number; purchased: number };

function stagedCount(rows: { catalog: string; count: number }[], catalog: string): number {
  return rows.find((row) => row.catalog === catalog)?.count ?? 0;
}

async function deleteProvider(
  client: pg.Client,
  sql: string,
): Promise<void> {
  for (;;) {
    const deleted = await client.query(sql);
    if ((deleted.rowCount ?? 0) === 0) return;
  }
}

async function copyCatalog(
  client: pg.Client,
  sql: string,
  runId: string,
): Promise<number> {
  let after = "";
  let inserted = 0;
  for (;;) {
    const wrote = await client.query<{ last: string; count: number }>(sql, [runId, after]);
    const count = Number(wrote.rows[0]?.count ?? 0);
    if (count === 0) return inserted;
    const last = wrote.rows[0]?.last ?? "";
    if (!last || last <= after) throw new PublishMismatch();
    inserted += count;
    after = last;
    if (count < COPY_CHUNK) return inserted;
  }
}

/** One transaction. Deletes and inserts only provider Finenumbers in both catalogs. */
export async function replaceFinenumbersCatalogs(
  runId: string,
  expected: number,
): Promise<PublishedCounts> {
  if (isFinenumbersStopping()) throw new Error(CANCELLED);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let committed = false;
  try {
    if (isFinenumbersStopping()) throw new Error(CANCELLED);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '600s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    const held = await client.query<{ run_id: string }>(
      `SELECT run_id
       FROM finenumbers_sync_state
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'
       FOR UPDATE`,
      [runId],
    );
    const overlap = await client.query<{ count: number }>(OVERLAP_SQL, [runId]);
    const staged = await client.query<{ catalog: string; count: number }>(STAGED_COUNT_SQL, [
      runId,
    ]);
    await deleteProvider(client, DELETE_FREE_CHUNK_SQL);
    const free = await copyCatalog(client, FREE_COPY_SQL, runId);
    await deleteProvider(client, DELETE_PURCHASED_CHUNK_SQL);
    const purchased = await copyCatalog(client, PURCHASED_COPY_SQL, runId);
    const decision = decidePublish({
      held: held.rows.length === 1,
      expected,
      overlap: overlap.rows[0]?.count ?? 0,
      stagedFree: stagedCount(staged.rows, "free"),
      insertedFree: free,
      stagedPurchased: stagedCount(staged.rows, "purchased"),
      insertedPurchased: purchased,
    });
    if (decision !== "commit") {
      throw held.rows.length === 1 ? new PublishMismatch() : new SyncLost();
    }
    await client.query(`DELETE FROM finenumbers_sync_stage WHERE run_id = $1`, [runId]);
    const finished = await client.query(
      `UPDATE finenumbers_sync_state
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
           purchased_loaded_at = CURRENT_TIMESTAMP,
           free_loaded_at = CURRENT_TIMESTAMP,
           last_finished_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND run_id = $1 AND phase = 'publishing'`,
      [runId, free, purchased],
    );
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    const epoch = await client.query(catalogEpochSql("finenumbers", "both"));
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
