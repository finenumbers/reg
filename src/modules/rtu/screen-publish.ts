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
import { markingLockSql, markingSupplierSyncSql } from "@/modules/marking/sql";
import {
  screenBuildInsertSql,
  screenBuildTable,
  screenBuildToken,
  screenStampsSql,
} from "@/modules/rtu/sql";

const SCREEN_RETRY_MS = 5_000;

let screenRetryWait: () => Promise<void> = () =>
  new Promise((resolve) => setTimeout(resolve, SCREEN_RETRY_MS));
let lastScreenRetryLog = 0;

/** Tests skip the pause between screen attempts. */
export function setScreenRetryWaitForTests(wait: () => Promise<void>): void {
  screenRetryWait = wait;
}

function noteScreenRetry(error: unknown): void {
  const now = Date.now();
  if (now - lastScreenRetryLog < 60_000) return;
  lastScreenRetryLog = now;
  logger.warn("rtu.screen.publish_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
}

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
  return publishUntilCurrent(deps);
}

async function publishUntilCurrent(deps: ScreenPublishDeps): Promise<ScreenPublishResult> {
  for (;;) {
    let token = "";
    let swapped = false;
    let started = false;
    try {
      const row = await deps.read(false);
      if (!row) throw new Error("Нет строки экрана.");
      const live = liveScreenStamps(row);
      if (row.published && screenStampsMatch(publishedScreenStamps(row), live)) {
        if (row.needs_publish) await deps.clearDirty();
        return { published: true };
      }
      token = screenBuildToken(deps.token());
      started = true;
      await deps.markDirty();
      await deps.build(token);
      await deps.swap(token, live);
      swapped = true;
      return { published: true };
    } catch (error) {
      noteScreenRetry(error);
      await screenRetryWait();
    } finally {
      if (started && !swapped) {
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
    `CREATE INDEX "rtu_screen_b_${token}_on_switch_idx" ON "${table}" ("number", "id") INCLUDE ("client", "supplier", "pstnKey") WHERE NOT missing`,
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
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '4s', true)`;
        await tx.$executeRaw(markingLockSql());
        await tx.$executeRaw(markingSupplierSyncSql());
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  } catch (error) {
    logger.warn("rtu.screen.marking_supplier_sync_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

let inflight: Promise<ScreenPublishResult> | null = null;

export function resetRtuScreenPublishForTests(): void {
  inflight = null;
  screenRetryWait = async () => undefined;
  lastScreenRetryLog = 0;
}

/**
 * One publish at a time. A caller that arrives while it is running shares that
 * pass. The pass reads the stamps again after a stale swap, so a sync that
 * lands mid-build is not skipped. The next call after it finishes reads again.
 */
export function enqueueScreenPublish(
  deps: ScreenPublishDeps,
): Promise<ScreenPublishResult> {
  if (inflight) return inflight;
  const run = runScreenPublish(deps).finally(() => {
    inflight = null;
  });
  inflight = run;
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

/** Same transaction as the supplier write. The marking lock is taken before the screen update. */
export async function patchRtuScreenSuppliers(
  tx: Prisma.TransactionClient,
  rows: readonly { id: string; supplier: string; category: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.$executeRaw(markingLockSql());
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
  await tx.$executeRaw(markingSupplierSyncSql());
}
