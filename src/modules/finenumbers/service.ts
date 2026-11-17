/**
 * One Finenumbers stage. There is no secret and no access check.
 * The walk, and nothing else, holds the in-memory slot.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { chainStartBlock } from "@/modules/numbering-chain/gate";
import { cardLabels } from "@/modules/numbering-sync/card-numbers";
import {
  isLockTimeout,
  isStatementTimeout,
  withDbRetry,
} from "@/modules/numbering-sync/db-retry";
import { armNumberingSyncStop } from "@/modules/numbering-sync/lease";
import { getDisplayTimezone } from "@/modules/settings/service";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import { endFinenumbers, isFinenumbersActive, isFinenumbersStopping, tryBeginFinenumbers } from "@/modules/finenumbers/lease";
import {
  appendFinenumbersLog,
  beginFinenumbersLog,
  finenumbersLogExists,
  flushFinenumbersLog,
  sanitizeLogLine,
} from "@/modules/finenumbers/log";
import { loadPhoneKeys } from "@/modules/finenumbers/phones";
import {
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceFinenumbersCatalogs,
  stageExpanded,
  SyncLost,
} from "@/modules/finenumbers/publish";
import { readInnRanges } from "@/modules/finenumbers/walk";

const BUSY = "Уже выполняется.";
const STOPPING = "Сервер останавливается. Каталог не изменён.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const FAILED = "Не удалось записать номера.";

export type FinenumbersSyncView = {
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
  duplicates: number;
  loadedAtLabel: string;
  hasLog: boolean;
};

type Actor = { userId: string | null; ip?: string | null };

type StateRow = {
  phase: string;
  list: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  duplicates_dropped: number;
  loaded_at: Date | null;
  staged_free: number;
  staged_purchased: number;
  busy: boolean;
};

function operatorError(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  return sanitizeLogLine(text) || FAILED;
}

function emptySync(hasLog: boolean): FinenumbersSyncView {
  return {
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
    duplicates: 0,
    loadedAtLabel: "—",
    hasLog,
  };
}

export async function getFinenumbersSyncView(): Promise<FinenumbersSyncView> {
  const [rows, hasLog, timeZone] = await Promise.all([
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        duplicates_dropped, loaded_at,
        (
          SELECT count(*)::int FROM finenumbers_sync_stage AS stage
          WHERE stage.run_id = finenumbers_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM finenumbers_sync_stage AS stage
          WHERE stage.run_id = finenumbers_sync_state.run_id
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
      FROM finenumbers_sync_state
      WHERE id = 1
    `,
    finenumbersLogExists(),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(hasLog);
  const busy = Boolean(state.busy) || isFinenumbersActive();
  return {
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
      duplicates: state.duplicates_dropped,
      loadedAt: state.loaded_at,
      timeZone,
    }),
    hasLog,
  };
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE finenumbers_sync_state
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
    UPDATE finenumbers_sync_state
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
    UPDATE finenumbers_sync_state
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

function beat(runId: string, pageDone: number, pageTotal: number): Promise<"ok" | "cancel" | "lost"> {
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE finenumbers_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            page_done = ${pageDone},
            page_total = ${pageTotal}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM finenumbers_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

async function noteFailure(actor: Actor): Promise<void> {
  await auditService
    .append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.FINENUMBERS_SYNC,
      entityType: "finenumbers",
      entityId: "finenumbers",
      ip: actor.ip,
      meta: { source: "finenumbers", failed: true },
    })
    .catch(() => undefined);
}

export async function startFinenumbersSync(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  const begun = tryBeginFinenumbers();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endFinenumbers(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM finenumbers_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endFinenumbers(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginFinenumbersLog();
  } catch {
    await release(runId).catch(() => undefined);
    endFinenumbers(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }

  let seenDone = 0;
  let seenTotal = 0;
  const keep = async () => {
    if (isFinenumbersStopping()) throw new Error(CANCELLED);
    const state = await beat(runId, seenDone, seenTotal);
    if (state === "cancel") throw new Error(CANCELLED);
    if (state === "lost") throw new SyncLost();
  };

  void (async () => {
    try {
      const phoneKeys = await loadPhoneKeys();
      const started = Date.now();
      const ranges = await readInnRanges({
        onProgress: async (seen, total) => {
          seenDone = seen;
          seenTotal = total;
          await keep();
          await appendFinenumbersLog(
            `Страница: ${seen} из ${total}, статус: прочитано, попытка: 1\n`,
          );
        },
      });
      if (!ranges.ok) throw new Error(ranges.error);
      await appendFinenumbersLog(
        `Диапазоны: ${ranges.ranges.length}, статус: сверено, длительность: ${Date.now() - started}\n`,
      );
      await stageExpanded({
        runId,
        ranges: ranges.ranges,
        phoneKeys,
        beat: keep,
      });
      await flushFinenumbersLog();
      await fillDraftSplit(runId, keep);
      if (isFinenumbersStopping()) throw new Error(CANCELLED);
      if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
      const marked = await markPublishing(runId);
      if (!marked) throw new SyncLost();
      if (isFinenumbersStopping()) throw new Error(CANCELLED);
      let published: { free: number; purchased: number };
      try {
        published = await replaceFinenumbersCatalogs(runId, ranges.capacity);
      } catch (error) {
        if (
          isLockTimeout(error) &&
          !(error instanceof SyncLost) &&
          !(error instanceof PublishMismatch) &&
          !isStatementTimeout(error)
        ) {
          await keep();
          if (isFinenumbersStopping()) throw new Error(CANCELLED);
          published = await replaceFinenumbersCatalogs(runId, ranges.capacity);
        } else {
          throw error;
        }
      }
      await appendFinenumbersLog(
        `Итог: свободных ${published.free}, купленных ${published.purchased}\n`,
      ).catch(() => undefined);
      await flushFinenumbersLog().catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.FINENUMBERS_SYNC,
          entityType: "finenumbers",
          entityId: "finenumbers",
          ip: actor.ip,
          meta: { source: "finenumbers", free: published.free, purchased: published.purchased },
        })
        .catch(() => undefined);
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message = operatorError(error);
      await appendFinenumbersLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushFinenumbersLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
      if (!(error instanceof SyncLost)) await noteFailure(actor);
    } finally {
      await flushFinenumbersLog().catch(() => undefined);
      endFinenumbers(holder);
    }
  })();
  return { ok: true };
}

export async function cancelFinenumbersSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE finenumbers_sync_state
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
