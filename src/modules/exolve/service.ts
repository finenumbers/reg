/**
 * One MTS Exolve stage. The key save, the access check, and the walk share one holder.
 * The key save does not take the database lease.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { cardLabels } from "@/modules/numbering-sync/card-numbers";
import { getDisplayTimezone } from "@/modules/settings/service";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { chainStartBlock } from "@/modules/numbering-chain/gate";
import { createExolveClient } from "@/modules/exolve/client";
import {
  endExolve,
  isExolveActive,
  isExolveStopping,
  tryBeginExolve,
} from "@/modules/exolve/lease";
import {
  appendExolveLog,
  beginExolveLog,
  exolveLogExists,
  flushExolveLog,
  sanitizeLogLine,
  type ExolveLogSide,
} from "@/modules/exolve/log";
import { planFreeCells } from "@/modules/exolve/parse";
import {
  dropPurchasedStage,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceExolveFree,
  replaceExolvePurchased,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/exolve/publish";
import { EXOLVE_ORIGIN } from "@/modules/exolve/url";
import {
  LOST,
  runExolveFreeWalk,
  runExolvePurchasedWalk,
  type ExolveProgress,
  type WalkBeat,
} from "@/modules/exolve/walk";
import {
  isLockTimeout,
  isStatementTimeout,
  withDbRetry,
} from "@/modules/numbering-sync/db-retry";
import { armNumberingSyncStop } from "@/modules/numbering-sync/lease";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";

const BUSY = "Уже выполняется.";
const STOPPING = "Сервер останавливается. Каталог не изменён.";
const NO_KEY = "Ключ ещё не задан.";
const BAD_SECRET = "Ключ не читается.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";

export type ExolveAccessView = {
  host: typeof EXOLVE_ORIGIN;
  hasKey: boolean;
};

export type ExolveSyncView = ExolveAccessView & {
  busy: boolean;
  phase: string;
  list: string;
  pageDone: number;
  pageTotal: number;
  lastError: string | null;
  lastFree: number | null;
  lastPurchased: number | null;
  freeShown: number | null;
  purchasedShown: number | null;
  purchasedLoadedAtLabel: string;
  freeLoadedAtLabel: string;
  hasPurchasedLog: boolean;
  hasFreeLog: boolean;
};

type Actor = { userId: string | null; ip?: string | null };
type ListName = "" | "purchased" | "free";

type StateRow = {
  phase: string;
  list: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  purchased_loaded_at: Date | null;
  free_loaded_at: Date | null;
  staged_free: number;
  staged_purchased: number;
  busy: boolean;
};

function emptySync(
  access: ExolveAccessView,
  hasPurchasedLog: boolean,
  hasFreeLog: boolean,
): ExolveSyncView {
  return {
    ...access,
    busy: false,
    phase: "",
    list: "",
    pageDone: 0,
    pageTotal: 0,
    lastError: null,
    lastFree: null,
    lastPurchased: null,
    freeShown: null,
    purchasedShown: null,
    purchasedLoadedAtLabel: "—",
    freeLoadedAtLabel: "—",
    hasPurchasedLog,
    hasFreeLog,
  };
}

async function readAccess(): Promise<ExolveAccessView> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "exolveApiKeyCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  return { host: EXOLVE_ORIGIN, hasKey: Boolean(rows[0]?.key) };
}

export async function getExolveAccessView(): Promise<ExolveAccessView> {
  return readAccess();
}

export async function getExolveSyncView(): Promise<ExolveSyncView> {
  const [access, rows, hasPurchasedLog, hasFreeLog, timeZone] = await Promise.all([
    readAccess(),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        purchased_loaded_at, free_loaded_at,
        (
          SELECT count(*)::int FROM exolve_sync_stage AS stage
          WHERE stage.run_id = exolve_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM exolve_sync_stage AS stage
          WHERE stage.run_id = exolve_sync_state.run_id
            AND stage.catalog = 'purchased'
        ) AS staged_purchased,
        (
          run_id IS NOT NULL
          AND phase IN ('running', 'publishing')
          AND (
            phase = 'publishing'
            OR (
              heartbeat_at IS NOT NULL
              AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
            )
          )
        ) AS busy
      FROM exolve_sync_state
      WHERE id = 1
    `,
    exolveLogExists("purchased"),
    exolveLogExists("free"),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasPurchasedLog, hasFreeLog);
  const busy = Boolean(state.busy) || isExolveActive();
  return {
    ...access,
    busy,
    phase: busy ? state.phase : "",
    list: busy ? state.list : "",
    pageDone: busy ? state.page_done : 0,
    pageTotal: busy ? state.page_total : 0,
    lastError: state.last_error,
    lastFree: state.last_free_written,
    lastPurchased: state.last_purchased_written,
    ...cardLabels({
      kind: "list",
      busy,
      step: null,
      list: busy ? state.list : "",
      phase: busy ? state.phase : "",
      lastFree: state.last_free_written,
      lastPurchased: state.last_purchased_written,
      stagedFree: state.staged_free,
      stagedPurchased: state.staged_purchased,
      purchasedLoadedAt: state.purchased_loaded_at,
      freeLoadedAt: state.free_loaded_at,
      timeZone,
    }),
    hasPurchasedLog,
    hasFreeLog,
  };
}

async function loadKey(): Promise<string> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "exolveApiKeyCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  if (!rows[0]?.key) throw new Error(NO_KEY);
  const { deserializeEncryptedSecret, getSecretEncryptionService } =
    await import("@/modules/ssh/secrets");
  try {
    return getSecretEncryptionService().decrypt(deserializeEncryptedSecret(rows[0].key));
  } catch {
    throw new Error(BAD_SECRET);
  }
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE exolve_sync_state
      SET run_id = ${runId},
          phase = 'running',
          list = '',
          page_done = 0,
          page_total = 0,
          error = NULL,
          heartbeat_at = CURRENT_TIMESTAMP,
          started_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND (
          run_id IS NULL
          OR heartbeat_at IS NULL
          OR heartbeat_at < CURRENT_TIMESTAMP - interval '2 minutes'
        )
      RETURNING run_id
    `;
    return rows.length === 1;
  } catch (error) {
    if (isLockTimeout(error)) return false;
    throw error;
  }
}

async function release(runId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE exolve_sync_state
    SET run_id = NULL,
        phase = '',
        list = '',
        page_done = 0,
        page_total = 0,
        heartbeat_at = NULL
    WHERE id = 1 AND run_id = ${runId}
  `;
}

async function finishError(runId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE exolve_sync_state
    SET run_id = NULL,
        phase = '',
        list = '',
        page_done = 0,
        page_total = 0,
        error = NULL,
        heartbeat_at = NULL,
        last_error = ${error},
        last_finished_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND run_id = ${runId}
  `;
}

function beat(
  runId: string,
  pageDone: number,
  pageTotal: number,
  list: ListName,
): Promise<"ok" | "cancel" | "lost"> {
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE exolve_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = ${list},
            page_done = ${pageDone},
            page_total = ${pageTotal}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM exolve_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

export async function saveExolveAccess(
  token: string | undefined,
  actor: Actor,
): Promise<{ ok: true; settings: ExolveAccessView } | { ok: false; error: string }> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return { ok: true, settings: await readAccess() };
  armNumberingSyncStop();
  const begun = tryBeginExolve();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  try {
    const { getSecretEncryptionService, serializeEncryptedSecret } =
      await import("@/modules/ssh/secrets");
    const ciphertext = serializeEncryptedSecret(
      getSecretEncryptionService().encrypt(trimmed),
    );
    const updated = await prisma.$executeRaw`
      UPDATE app_settings
      SET "exolveApiKeyCiphertext" = ${ciphertext},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 1
    `;
    if (updated !== 1) return { ok: false, error: "Настройки не найдены." };
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.EXOLVE_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: { source: "exolve", keyReplaced: true },
    });
    return { ok: true, settings: await readAccess() };
  } finally {
    endExolve(begun.token);
  }
}

/** Purchased page, the directory, then the first free cell. No catalog write. */
export async function testExolveAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginExolve();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) return { ok: false, error: BUSY };
    let key: string;
    try {
      key = await loadKey();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
    }
    const keep = async () => {
      const state = await beat(runId, 0, 0, "");
      if (state !== "ok") throw new Error(BUSY);
    };
    const client = createExolveClient(key, { beat: keep });
    const purchased = await client.purchased({ kind: "all" }, 0);
    if (!purchased.ok) {
      await auditService.append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.EXOLVE_TEST,
        entityType: "exolve",
        entityId: "exolve",
        ip: actor.ip,
        meta: { source: "exolve", ok: false },
      });
      return { ok: false, error: purchased.error };
    }
    const directory = await client.directory();
    if (!directory.ok) {
      await auditService.append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.EXOLVE_TEST,
        entityType: "exolve",
        entityId: "exolve",
        ip: actor.ip,
        meta: { source: "exolve", ok: false },
      });
      return { ok: false, error: directory.error };
    }
    const cells = planFreeCells(directory.directory);
    if (!cells.ok) {
      await auditService.append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.EXOLVE_TEST,
        entityType: "exolve",
        entityId: "exolve",
        ip: actor.ip,
        meta: { source: "exolve", ok: false },
      });
      return { ok: false, error: cells.error };
    }
    const free = await client.free(cells.cells[0], 0);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.EXOLVE_TEST,
      entityType: "exolve",
      entityId: "exolve",
      ip: actor.ip,
      meta: { source: "exolve", ok: free.ok },
    });
    if (!free.ok) return { ok: false, error: free.error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : BUSY };
  } finally {
    if (claimed) await release(runId).catch(() => undefined);
    endExolve(holder);
  }
}

function lostLease(error: unknown): boolean {
  return error instanceof SyncLost || (error instanceof Error && error.name === "SyncLost");
}

export function startExolvePurchased(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return startExolveSide(actor, options, "purchased");
}

export function startExolveFree(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return startExolveSide(actor, options, "free");
}

async function startExolveSide(
  actor: Actor,
  options: { fromChain?: boolean } | undefined,
  side: ExolveLogSide,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  const begun = tryBeginExolve();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  let key: string;
  try {
    key = await loadKey();
  } catch (error) {
    endExolve(holder);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endExolve(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM exolve_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endExolve(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginExolveLog(runId, side);
  } catch {
    await release(runId).catch(() => undefined);
    endExolve(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }

  let seenList: ListName = side;
  let seenDone = 0;
  let seenTotal = 0;
  const walkBeat: WalkBeat = async (patch: ExolveProgress) => {
    if (patch.list != null) seenList = patch.list;
    if (patch.pageDone != null) seenDone = patch.pageDone;
    if (patch.pageTotal != null) seenTotal = patch.pageTotal;
    if (isExolveStopping()) return "cancel";
    const state = await beat(runId, seenDone, seenTotal, seenList);
    if (state === "ok") return "run";
    return state;
  };
  const keep = async () => {
    const state = await walkBeat({});
    if (state === "cancel") throw new Error(CANCELLED);
    if (state === "lost") throw new SyncLost();
  };
  const client = createExolveClient(key, {
    beat: keep,
    note: (line) => appendExolveLog(`${line}\n`),
  });
  const readDirectory = async () => {
    const page = await client.directory();
    if (!page.ok) return page;
    return { ok: true as const, directory: page.directory };
  };
  const replace = side === "purchased" ? replaceExolvePurchased : replaceExolveFree;
  const walk =
    side === "purchased"
      ? runExolvePurchasedWalk({
          beat: walkBeat,
          purchased: (filter, offset) => client.purchased(filter, offset),
          recount: () => client.recount(),
          directory: readDirectory,
          stagePurchased: (rows) => stagePurchasedNumbers(runId, rows, keep),
          dropPurchased: () => dropPurchasedStage(runId),
          log: (line) => appendExolveLog(`${line}\n`),
        })
      : runExolveFreeWalk({
          beat: walkBeat,
          directory: readDirectory,
          free: (cell, offset, mode) => client.free(cell, offset, mode),
          stageFree: (rows) => stageFreeNumbers(runId, rows, keep),
          log: (line) => appendExolveLog(`${line}\n`),
        });

  void (async () => {
    try {
      const result = await walk;
      if (!result.ok) {
        await dropStage(runId).catch(() => undefined);
        const message = sanitizeLogLine(result.error) || LOST;
        await appendExolveLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
          () => undefined,
        );
        await flushExolveLog().catch(() => undefined);
        await finishError(runId, message);
        if (result.reason !== "lost") {
          await auditService
            .append({
              actorUserId: actor.userId,
              action: AUDIT_ACTIONS.EXOLVE_SYNC,
              entityType: "exolve",
              entityId: "exolve",
              ip: actor.ip,
              meta: { source: "exolve", side, failed: true },
            })
            .catch(() => undefined);
        }
        return;
      }

      await flushExolveLog();
      await fillDraftSplit(runId, keep);
      if (isExolveStopping()) throw new Error(CANCELLED);
      if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
      const marked = await markPublishing(runId);
      if (!marked) throw new SyncLost();
      if (isExolveStopping()) throw new Error(CANCELLED);
      let published: { deleted: number; inserted: number };
      try {
        published = await replace(runId);
      } catch (error) {
        if (
          isLockTimeout(error) &&
          !lostLease(error) &&
          !(error instanceof PublishMismatch) &&
          !isStatementTimeout(error)
        ) {
          await keep();
          if (isExolveStopping()) throw new Error(CANCELLED);
          published = await replace(runId);
        } else {
          throw error;
        }
      }
      const title = side === "purchased" ? "куплено" : "свободно";
      await appendExolveLog(`Итог: ${title} ${published.inserted}\n`).catch(() => undefined);
      await flushExolveLog().catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.EXOLVE_SYNC,
          entityType: "exolve",
          entityId: "exolve",
          ip: actor.ip,
          meta: { source: "exolve", side, inserted: published.inserted },
        })
        .catch(() => undefined);
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message = lostLease(error)
        ? LOST
        : (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
          "Не удалось записать номера.";
      await appendExolveLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushExolveLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
      if (!lostLease(error)) {
        await auditService
          .append({
            actorUserId: actor.userId,
            action: AUDIT_ACTIONS.EXOLVE_SYNC,
            entityType: "exolve",
            entityId: "exolve",
            ip: actor.ip,
            meta: { source: "exolve", side, failed: true },
          })
          .catch(() => undefined);
      }
    } finally {
      endExolve(holder);
    }
  })();
  return { ok: true };
}

export async function cancelExolveSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE exolve_sync_state
      SET phase = 'cancel', heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND phase = 'running' AND run_id IS NOT NULL
      RETURNING run_id
    `;
    if (rows.length !== 1) return { ok: false, error: "Запись уже началась." };
    return { ok: true };
  } catch (error) {
    if (isLockTimeout(error)) return { ok: false, error: "Запись уже началась." };
    throw error;
  }
}
