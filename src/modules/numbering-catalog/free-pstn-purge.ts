/**
 * After decorate is idle, move free_numbers with pstn_hits 0/2 into the excluded table.
 * Empty pstn_range_snapshot skips the purge so a missing registry does not wipe free.
 */

import pg from "pg";

import { prisma } from "@/lib/db";
import { noteCatalogReplaced } from "@/modules/numbering-sync/lease";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/locks";

/** Same size and pause as decorate batches. */
export const PURGE_CHUNK = 1000;
export const PURGE_PAUSE_MS = 500;

const SNAPSHOT_NONEMPTY_SQL = `
  SELECT 1 AS ok FROM pstn_range_snapshot LIMIT 1
`;

const MISS_COUNT_SQL = `
  SELECT count(*)::int AS count
  FROM free_numbers
  WHERE pstn_hits IN (0, 2)
`;

const MOVE_CHUNK_SQL = `
  WITH picked AS (
    SELECT id, provider, e164, abc, "number", city, region
    FROM free_numbers
    WHERE pstn_hits IN (0, 2)
    ORDER BY id
    LIMIT ${PURGE_CHUNK}
  ),
  stored AS (
    INSERT INTO numbering_free_pstn_excluded (provider, e164, abc, "number", city, region)
    SELECT provider, e164, abc, "number", city, region
    FROM picked
    ON CONFLICT (provider, e164) DO UPDATE SET
      abc = EXCLUDED.abc,
      "number" = EXCLUDED."number",
      city = EXCLUDED.city,
      region = EXCLUDED.region
    RETURNING e164
  )
  DELETE FROM free_numbers f
  USING picked
  WHERE f.id = picked.id
  RETURNING f.id
`;

/** True when every decorate epoch is caught up (same idle rule as nextDecorateStep). */
const DEBT_IDLE_SQL = `
  SELECT 1 AS ok
  FROM numbering_catalog_state
  WHERE id = 1
    AND decorate_generation > 0
    AND resplit_epoch = resplit_done
    AND mask_epoch = mask_done
    AND sipout_epoch = sipout_done
    AND runexis_epoch = runexis_done
    AND uis_epoch = uis_done
    AND aurora_epoch = aurora_done
    AND exolve_epoch = exolve_done
    AND voximplant_epoch = voximplant_done
    AND mcn_epoch = mcn_done
    AND finenumbers_epoch = finenumbers_done
    AND pstn_range_epoch = pstn_range_done
    AND client_epoch = client_done
`;

function asCount(value: unknown): number {
  return Number(value ?? 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function snapshotNonempty(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ ok: number }[]>(SNAPSHOT_NONEMPTY_SQL);
  return rows.length > 0;
}

async function missCount(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(MISS_COUNT_SQL);
  return asCount(rows[0]?.count);
}

async function debtIdle(client?: pg.Client): Promise<boolean> {
  if (client) {
    const locked = await client.query<{ ok: number }>(DEBT_IDLE_SQL);
    return locked.rows.length > 0;
  }
  const rows = await prisma.$queryRawUnsafe<{ ok: number }[]>(DEBT_IDLE_SQL);
  return rows.length > 0;
}

async function moveChunk(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '600s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    for (const sql of RESPLIT_LOCKS) {
      const locked = await client.query<{ run_id: string | null; fresh: boolean }>(sql);
      const row = locked.rows[0];
      if (row?.run_id && row.fresh) throw new SyncBusy();
    }
    if (!(await debtIdle(client))) throw new SyncBusy();
    const moved = await client.query<{ id: string }>(MOVE_CHUNK_SQL);
    await client.query("COMMIT");
    return moved.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Called only when decorate debt is idle and the PSTN snapshot refresh already ran.
 * Throws SyncBusy when a live walk holds a lease so settleUntilClear retries.
 */
export async function purgeFreePstnMisses(): Promise<void> {
  if (!(await snapshotNonempty())) return;
  let movedTotal = 0;
  for (;;) {
    const moved = await moveChunk();
    if (moved === 0) break;
    movedTotal += moved;
    await wait(PURGE_PAUSE_MS);
  }
  if (movedTotal > 0) {
    try {
      noteCatalogReplaced();
    } catch {
      /* Export generation catches up on the next request. */
    }
  }
  if ((await snapshotNonempty()) && (await missCount()) > 0) {
    throw new SyncBusy();
  }
}
