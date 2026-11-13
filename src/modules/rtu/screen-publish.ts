/**
 * Publish «Управление РТУ» beside the live table, then swap names.
 * Readers keep the previous table until the swap commits.
 * One process queues the publishes. A later caller runs after the earlier one
 * and reads stamps again, so a sync that landed mid-build is not skipped.
 */

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  screenBuildInsertSql,
  screenBuildTable,
  screenBuildToken,
  screenStampsSql,
} from "@/modules/rtu/sql";

const ATTEMPTS = 3;

export type ScreenStamps = {
  phonesSyncedAt: Date | null;
  supplierRevision: number;
  didHash: string;
  didGeneration: number;
  tariffGeneration: number;
  maskGeneration: number;
};

export type ScreenPublishResult = {
  published: boolean;
};

export type StampRow = {
  phones_synced_at: Date | null;
  tariff_generation: number;
  supplier_revision: number;
  published_supplier_revision: number;
  published_did_hash: string | null;
  published_phones_synced_at: Date | null;
  published_tariff_generation: number;
  mask_generation: number;
  published_mask_generation: number;
  published: boolean;
  needs_publish: boolean;
  catalog_revision: number;
  did_generation: number;
  did_hash: string | null;
};

export type ScreenGate = {
  published: boolean;
  needsPublish: boolean;
  catalogRevision: number;
};

class ScreenStaleError extends Error {
  constructor() {
    super("screen stamps changed");
    this.name = "ScreenStaleError";
  }
}

export function screenStampsMatch(published: ScreenStamps, live: ScreenStamps): boolean {
  return (
    sameTime(published.phonesSyncedAt, live.phonesSyncedAt) &&
    published.supplierRevision === live.supplierRevision &&
    published.didHash === live.didHash &&
    published.tariffGeneration === live.tariffGeneration &&
    published.maskGeneration === live.maskGeneration
  );
}

/** Cheap stamps only. The DID hash stays the one read before the build. */
export function screenSwapFresh(observed: ScreenStamps, current: ScreenStamps): boolean {
  return (
    sameTime(observed.phonesSyncedAt, current.phonesSyncedAt) &&
    observed.supplierRevision === current.supplierRevision &&
    observed.didGeneration === current.didGeneration &&
    observed.tariffGeneration === current.tariffGeneration &&
    observed.maskGeneration === current.maskGeneration
  );
}

function sameTime(left: Date | null, right: Date | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  return left.getTime() === right.getTime();
}

function asDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function liveScreenStamps(row: StampRow): ScreenStamps {
  return {
    phonesSyncedAt: asDate(row.phones_synced_at),
    supplierRevision: Number(row.supplier_revision) || 0,
    didHash: row.did_hash ?? "",
    didGeneration: Number(row.did_generation) || 0,
    tariffGeneration: Number(row.tariff_generation) || 0,
    maskGeneration: Number(row.mask_generation) || 0,
  };
}

export function publishedScreenStamps(row: StampRow): ScreenStamps {
  return {
    phonesSyncedAt: asDate(row.published_phones_synced_at),
    supplierRevision: Number(row.published_supplier_revision) || 0,
    didHash: row.published_did_hash ?? "",
    didGeneration: Number(row.did_generation) || 0,
    tariffGeneration: Number(row.published_tariff_generation) || 0,
    maskGeneration: Number(row.published_mask_generation) || 0,
  };
}

function isStale(error: unknown): boolean {
  if (error instanceof ScreenStaleError) return true;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("screen stamps changed")) return true;
  if (error && typeof error === "object" && "cause" in error) {
    return isStale((error as { cause: unknown }).cause);
  }
  return false;
}

function isLockTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("55P03") || message.toLowerCase().includes("lock timeout")) {
    return true;
  }
  if (error && typeof error === "object" && "cause" in error) {
    return isLockTimeout((error as { cause: unknown }).cause);
  }
  return false;
}

export type ScreenPublishDeps = {
  read: (forUpdate: boolean) => Promise<StampRow | null>;
  markDirty: () => Promise<void>;
  clearDirty: () => Promise<void>;
  build: (token: string) => Promise<void>;
  swap: (token: string, live: ScreenStamps) => Promise<void>;
  dropBuild: (token: string) => Promise<void>;
  token: () => string;
};

export async function runScreenPublish(
  deps: ScreenPublishDeps,
): Promise<ScreenPublishResult> {
  try {
    return await publishAttempts(deps);
  } catch (error) {
    logger.warn("rtu.screen.publish_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { published: false };
  }
}

async function publishAttempts(deps: ScreenPublishDeps): Promise<ScreenPublishResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const row = await deps.read(false);
    if (!row) return { published: false };
    const live = liveScreenStamps(row);
    if (row.published && screenStampsMatch(publishedScreenStamps(row), live)) {
      if (row.needs_publish) await deps.clearDirty();
      return { published: true };
    }
    const token = screenBuildToken(deps.token());
    let swapped = false;
    try {
      await deps.markDirty();
      await deps.build(token);
      try {
        await deps.swap(token, live);
        swapped = true;
        return { published: true };
      } catch (error) {
        if (isStale(error) || isLockTimeout(error)) continue;
        throw error;
      }
    } catch (error) {
      if (isStale(error) || isLockTimeout(error)) continue;
      logger.warn("rtu.screen.publish_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { published: false };
    } finally {
      if (!swapped) {
        try {
          await deps.dropBuild(token);
        } catch (error) {
          logger.warn("rtu.screen.drop_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
  logger.warn("rtu.screen.publish_unsettled", {});
  return { published: false };
}

function swapDdl(token: string): string[] {
  const safe = screenBuildToken(token);
  const build = screenBuildTable(safe);
  const old = `rtu_screen_old_${safe}`;
  const rename = (from: string, to: string) =>
    `ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`;
  return [
    rename("rtu_screen_number_id_idx", `rtu_screen_number_id_idx_${safe}`),
    rename("rtu_screen_activation_idx", `rtu_screen_activation_idx_${safe}`),
    rename("rtu_screen_missing_idx", `rtu_screen_missing_idx_${safe}`),
    rename("rtu_screen_number_trgm_idx", `rtu_screen_number_trgm_idx_${safe}`),
    rename("rtu_screen_on_switch_idx", `rtu_screen_on_switch_idx_${safe}`),
    rename(`rtu_screen_b_${safe}_number_id_idx`, "rtu_screen_number_id_idx"),
    rename(`rtu_screen_b_${safe}_activation_idx`, "rtu_screen_activation_idx"),
    rename(`rtu_screen_b_${safe}_missing_idx`, "rtu_screen_missing_idx"),
    rename(`rtu_screen_b_${safe}_number_trgm_idx`, "rtu_screen_number_trgm_idx"),
    rename(`rtu_screen_b_${safe}_on_switch_idx`, "rtu_screen_on_switch_idx"),
    `ALTER TABLE "rtu_screen" RENAME TO "${old}"`,
    `ALTER TABLE "${build}" RENAME TO "rtu_screen"`,
  ];
}

function oldScreenTable(token: string): string {
  return `rtu_screen_old_${screenBuildToken(token)}`;
}

async function readStamp(forUpdate: boolean): Promise<StampRow | null> {
  const rows = await prisma.$queryRaw<StampRow[]>(screenStampsSql(forUpdate));
  return rows[0] ?? null;
}

async function buildScreen(token: string): Promise<void> {
  const table = screenBuildTable(token);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE "${table}" (LIKE "rtu_screen" INCLUDING DEFAULTS)`,
  );
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD PRIMARY KEY ("id")`);
  await prisma.$executeRaw(screenBuildInsertSql(token));
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "rtu_screen_b_${token}_number_id_idx" ON "${table}" ("number", "id")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "rtu_screen_b_${token}_activation_idx" ON "${table}" ("activation")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "rtu_screen_b_${token}_missing_idx" ON "${table}" ("missing")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "rtu_screen_b_${token}_number_trgm_idx" ON "${table}" USING gin ("number" gin_trgm_ops)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "rtu_screen_b_${token}_on_switch_idx" ON "${table}" ("number", "id") INCLUDE ("client", "pstnKey") WHERE NOT missing`,
  );
}

async function dropBuild(token: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${screenBuildTable(token)}"`);
}

async function swapScreen(token: string, observed: ScreenStamps): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', '4s', true)`;
      const row = (await tx.$queryRaw<StampRow[]>(screenStampsSql(true)))[0];
      if (!row || !screenSwapFresh(observed, liveScreenStamps(row))) {
        throw new ScreenStaleError();
      }
      for (const statement of swapDdl(token)) {
        await tx.$executeRawUnsafe(statement);
      }
      const updated = await tx.$executeRaw`
        UPDATE rtu_screen_state
        SET published = true,
            "needsPublish" = false,
            "phonesSyncedAt" = ${observed.phonesSyncedAt},
            "publishedSupplierRevision" = ${observed.supplierRevision},
            "didHash" = ${observed.didHash},
            "tariffGeneration" = ${observed.tariffGeneration},
            "maskGeneration" = ${observed.maskGeneration},
            "catalogRevision" = "catalogRevision" + 1,
            "publishedAt" = NOW()
        WHERE id = 1
          AND "supplierRevision" = ${observed.supplierRevision}
          AND COALESCE(
            (SELECT generation FROM number_mask_import_state WHERE id = 1),
            0
          ) = ${observed.maskGeneration}
      `;
      if (Number(updated) !== 1) throw new ScreenStaleError();
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${oldScreenTable(token)}"`);
  } catch (error) {
    logger.warn("rtu.screen.drop_old_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const defaultDeps: ScreenPublishDeps = {
  read: readStamp,
  markDirty: async () => {
    await prisma.$executeRaw`
      UPDATE rtu_screen_state SET "needsPublish" = true WHERE id = 1
    `;
  },
  clearDirty: async () => {
    await prisma.$executeRaw`
      UPDATE rtu_screen_state SET "needsPublish" = false WHERE id = 1
    `;
  },
  build: buildScreen,
  swap: swapScreen,
  dropBuild,
  token: () => randomBytes(4).toString("hex"),
};

let tail: Promise<ScreenPublishResult> = Promise.resolve({ published: true });

export function resetRtuScreenPublishForTests(): void {
  tail = Promise.resolve({ published: true });
}

/** Queue one publish. The caller waits for a pass that starts after earlier ones. */
export function enqueueScreenPublish(
  deps: ScreenPublishDeps,
): Promise<ScreenPublishResult> {
  const run = tail.then(
    () => runScreenPublish(deps),
    () => runScreenPublish(deps),
  );
  tail = run.then(
    (result) => result,
    () => ({ published: false }),
  );
  return run;
}

export function requestRtuScreenPublish(): Promise<ScreenPublishResult> {
  return enqueueScreenPublish(defaultDeps);
}

export async function readRtuScreenGate(): Promise<ScreenGate | null> {
  const rows = await prisma.$queryRaw<
    { published: boolean; needs_publish: boolean; catalog_revision: number }[]
  >`
    SELECT published, "needsPublish" AS needs_publish, "catalogRevision"::int AS catalog_revision
    FROM rtu_screen_state
    WHERE id = 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    published: row.published === true,
    needsPublish: row.needs_publish === true,
    catalogRevision: Number(row.catalog_revision) || 0,
  };
}

/** Same transaction as the supplier write. Locks the state row before the screen update. */
export async function patchRtuScreenSuppliers(
  tx: Prisma.TransactionClient,
  rows: readonly { id: string; supplier: string; category: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.$executeRaw`SELECT 1 FROM rtu_screen_state WHERE id = 1 FOR UPDATE`;
  for (const row of rows) {
    await tx.$executeRaw`
      UPDATE rtu_screen
      SET supplier = ${row.supplier}, category = ${row.category}
      WHERE id = ${row.id}
    `;
  }
  await tx.$executeRaw`
    UPDATE rtu_screen_state
    SET "supplierRevision" = "supplierRevision" + 1,
        "publishedSupplierRevision" = CASE
          WHEN published THEN "supplierRevision" + 1
          ELSE "publishedSupplierRevision"
        END,
        "catalogRevision" = "catalogRevision" + 1
    WHERE id = 1
  `;
}
