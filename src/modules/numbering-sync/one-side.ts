/**
 * Replace one provider slice. The caller passes the DELETE and the copy.
 * A zero staged count still deletes that slice and inserts nothing.
 */

import pg from "pg";

import { requestDecorateCatchUp } from "@/modules/numbering-catalog/decorate";
import { SyncLost } from "@/modules/numbering-sync/errors";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";

export class PublishMismatch extends Error {
  constructor() {
    super("Не удалось записать номера.");
    this.name = "PublishMismatch";
  }
}

export type SideWrite = { deleted: number; inserted: number };

export async function publishOneSide(input: {
  runId: string;
  lockSql: string;
  countSql: string;
  countParams: unknown[];
  deleteSql: string;
  copySql: string;
  clearStageSql: string;
  finishSql: string;
  epochSql: string;
}): Promise<SideWrite> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '600s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    const held = await client.query<{ run_id: string }>(input.lockSql, [input.runId]);
    const staged = await client.query<{ count: number }>(input.countSql, input.countParams);
    const stagedCount = staged.rows[0]?.count ?? 0;
    const deleted = (await client.query(input.deleteSql)).rowCount ?? 0;
    const inserted = (await client.query(input.copySql, [input.runId])).rowCount ?? 0;
    if (held.rows.length !== 1) throw new SyncLost();
    if (stagedCount !== inserted) throw new PublishMismatch();
    await client.query(input.clearStageSql, [input.runId]);
    const finished = await client.query(input.finishSql, [input.runId, inserted]);
    if ((finished.rowCount ?? 0) !== 1) throw new SyncLost();
    const epoch = await client.query(input.epochSql);
    if ((epoch.rowCount ?? 0) !== 1) throw new Error("Не удалось отметить каталог.");
    await client.query("COMMIT");
    committed = true;
    try {
      noteCatalogReplaced();
    } catch {
      /* The catalog is already replaced. The export generation catches up. */
    }
    try {
      requestDecorateCatchUp();
    } catch {
      /* The epoch stays ahead. The next start fills the cells. */
    }
    return { deleted, inserted };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
