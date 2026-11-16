/**
 * One UIS stage. The key save, the access check, and the walk share one holder.
 * The key save does not take the database lease.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { cardLabels } from "@/modules/numbering-sync/card-numbers";
import { getDisplayTimezone } from "@/modules/settings/service";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { chainStartBlock } from "@/modules/numbering-chain/gate";
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
import { uisCall } from "@/modules/uis/client";
import { endUis, isUisActive, isUisStopping, tryBeginUis } from "@/modules/uis/lease";
import {
  appendUisLog,
  beginUisLog,
  flushUisLog,
  sanitizeLogLine,
  uisLogExists,
} from "@/modules/uis/log";
import { accessPageOk } from "@/modules/uis/parse";
import {
  dropPurchasedOverlap,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceUisCatalogs,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/uis/publish";
import { UIS_ORIGIN, type UisList } from "@/modules/uis/url";
import { runUisWalk, type LeaseBeat } from "@/modules/uis/walk";

const BUSY = "Уже выполняется.";
const STOPPING = "Сервер останавливается. Каталог не изменён.";
const NO_KEY = "Ключ ещё не задан.";
const BAD_SECRET = "Ключ не читается.";
const BAD_PAGE = "Площадка отклонила доступ.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";

export type UisAccessView = {
  host: typeof UIS_ORIGIN;
  hasKey: boolean;
};

export type UisSyncView = UisAccessView & {
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

function emptySync(access: UisAccessView, hasLog: boolean): UisSyncView {
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
    duplicates: 0,
    loadedAtLabel: "—",
    hasLog,
  };
}

async function readAccess(): Promise<UisAccessView> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "uisApiKeyCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  return { host: UIS_ORIGIN, hasKey: Boolean(rows[0]?.key) };
}

export async function getUisAccessView(): Promise<UisAccessView> {
  return readAccess();
}

export async function getUisSyncView(): Promise<UisSyncView> {
  const [access, rows, hasLog, timeZone] = await Promise.all([
    readAccess(),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        duplicates_dropped, loaded_at,
        (
          SELECT count(*)::int FROM uis_sync_stage AS stage
          WHERE stage.run_id = uis_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM uis_sync_stage AS stage
          WHERE stage.run_id = uis_sync_state.run_id
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
      FROM uis_sync_state
      WHERE id = 1
    `,
    uisLogExists(),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasLog);
  const busy = Boolean(state.busy) || isUisActive();
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
      duplicates: state.duplicates_dropped,
      loadedAt: state.loaded_at,
      timeZone,
    }),
    hasLog,
  };
}

async function loadKey(): Promise<string> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "uisApiKeyCiphertext" AS key
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
      UPDATE uis_sync_state
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
    UPDATE uis_sync_state
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
    UPDATE uis_sync_state
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
  accepted: number,
  total: number,
  list: UisList | "",
): Promise<LeaseBeat> {
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE uis_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = ${list},
            page_done = ${accepted},
            page_total = ${total}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM uis_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

export async function saveUisAccess(
  token: string | undefined,
  actor: Actor,
): Promise<{ ok: true; settings: UisAccessView } | { ok: false; error: string }> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return { ok: true, settings: await readAccess() };
  armNumberingSyncStop();
  const begun = tryBeginUis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  try {
    const { getSecretEncryptionService, serializeEncryptedSecret } =
      await import("@/modules/ssh/secrets");
    const ciphertext = serializeEncryptedSecret(
      getSecretEncryptionService().encrypt(trimmed),
    );
    const updated = await prisma.$executeRaw`
      UPDATE app_settings
      SET "uisApiKeyCiphertext" = ${ciphertext},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 1
    `;
    if (updated !== 1) return { ok: false, error: "Настройки не найдены." };
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.UIS_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: { source: "uis", keyReplaced: true },
    });
    return { ok: true, settings: await readAccess() };
  } finally {
    endUis(begun.token);
  }
}

/** One purchased page, one purchased probe, then the same pair for free numbers. */
export async function testUisAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginUis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
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
    const purchased = await uisCall(
      key,
      "purchased",
      { purpose: "access" },
      { beat: keep },
    );
    const boughtOk =
      purchased.ok &&
      purchased.rows != null &&
      accessPageOk(purchased.total, purchased.rows.length);
    const boughtProbe = boughtOk
      ? await uisCall(key, "purchased", { purpose: "probe" }, { beat: keep })
      : null;
    const free = boughtProbe?.ok
      ? await uisCall(key, "free", { purpose: "access" }, { beat: keep })
      : null;
    const freeOk = Boolean(
      free?.ok && free.rows != null && accessPageOk(free.total, free.rows.length),
    );
    const freeProbe = freeOk
      ? await uisCall(key, "free", { purpose: "probe" }, { beat: keep })
      : null;
    const ok = Boolean(boughtOk && boughtProbe?.ok && freeOk && freeProbe?.ok);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.UIS_TEST,
      entityType: "uis",
      entityId: "uis",
      ip: actor.ip,
      meta: { source: "uis", ok },
    });
    if (!purchased.ok) return { ok: false, error: purchased.error };
    if (!boughtOk) return { ok: false, error: BAD_PAGE };
    if (!boughtProbe?.ok) return { ok: false, error: boughtProbe?.error ?? BAD_PAGE };
    if (!free?.ok) return { ok: false, error: free?.error ?? BAD_PAGE };
    if (!freeOk) return { ok: false, error: BAD_PAGE };
    if (!freeProbe?.ok) return { ok: false, error: freeProbe?.error ?? BAD_PAGE };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : BAD_PAGE };
  } finally {
    if (claimed) await release(runId).catch(() => undefined);
    endUis(holder);
  }
}

export async function startUisSync(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  const begun = tryBeginUis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const holder = begun.token;
  let key: string;
  try {
    key = await loadKey();
  } catch (error) {
    endUis(holder);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endUis(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM uis_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endUis(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginUisLog(runId);
  } catch {
    await release(runId).catch(() => undefined);
    endUis(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }
  let seenList: UisList = "purchased";
  let seenAccepted = 0;
  let seenTotal = 0;
  const keep = async () => {
    const state = await beat(runId, seenAccepted, seenTotal, seenList);
    if (state === "cancel") throw new Error("Загрузка отменена. Каталог не изменён.");
    if (state === "lost") throw new SyncLost();
  };
  let duplicates = 0;
  void (async () => {
    try {
      const result = await runUisWalk({
        count: (list, filter) =>
          uisCall(key, list, { purpose: "count", filter }, { beat: keep }),
        page: (list, filter, offset) =>
          uisCall(key, list, { purpose: "read", filter, offset }, { beat: keep }),
        stillMine: async () => {
          if (isUisStopping()) return "cancel";
          return beat(runId, seenAccepted, seenTotal, seenList);
        },
        stopping: isUisStopping,
        stageFree: (rows) => stageFreeNumbers(runId, rows),
        stagePurchased: (dids) => stagePurchasedNumbers(runId, dids),
        prepare: async () => {
          const removed = await dropPurchasedOverlap(runId);
          duplicates += removed;
          if (removed > 0) {
            await appendUisLog(
              `Совпадение: ${removed} номеров убраны из свободных, они куплены.\n`,
            ).catch(() => undefined);
          }
          await flushUisLog().catch(() => undefined);
          await fillDraftSplit(runId, async () => {
            const state = await beat(runId, seenAccepted, seenTotal, seenList);
            if (state === "cancel")
              throw new Error("Загрузка отменена. Каталог не изменён.");
            if (state === "lost") throw new SyncLost();
          });
        },
        publish: async () => {
          if (isUisStopping()) throw new Error("Загрузка отменена. Каталог не изменён.");
          if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
          const marked = await markPublishing(runId);
          if (!marked) throw new SyncLost();
          if (isUisStopping()) throw new Error("Загрузка отменена. Каталог не изменён.");
          try {
            return await replaceUisCatalogs(runId, duplicates);
          } catch (error) {
            if (
              isLockTimeout(error) &&
              !(error instanceof SyncLost) &&
              !(error instanceof PublishMismatch) &&
              !isStatementTimeout(error)
            ) {
              const state = await beat(runId, seenAccepted, seenTotal, seenList);
              if (state !== "ok") throw new SyncLost();
              if (isUisStopping())
                throw new Error("Загрузка отменена. Каталог не изменён.");
              return replaceUisCatalogs(runId, duplicates);
            }
            throw error;
          }
        },
        dropStage: () => dropStage(runId),
        progress: async (list, accepted, total) => {
          seenList = list;
          seenAccepted = accepted;
          seenTotal = total;
          const state = await beat(runId, accepted, total, list);
          if (state === "cancel")
            throw new Error("Загрузка отменена. Каталог не изменён.");
          if (state === "lost") throw new SyncLost();
        },
        log: (block) => appendUisLog(block),
        flushLog: () => flushUisLog(),
      });
      if (!result.ok) {
        await finishError(
          runId,
          sanitizeLogLine(result.error) || "Загрузка прервана. Каталог не изменён.",
        );
      }
      if (result.ok || result.reason !== "lost") {
        await auditService
          .append({
            actorUserId: actor.userId,
            action: AUDIT_ACTIONS.UIS_SYNC,
            entityType: "uis",
            entityId: "uis",
            ip: actor.ip,
            meta: result.ok
              ? { source: "uis", free: result.free, purchased: result.purchased }
              : { source: "uis", failed: true },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message =
        (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
        "Не удалось записать номера.";
      await appendUisLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushUisLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
    } finally {
      endUis(holder);
    }
  })();
  return { ok: true };
}

export async function cancelUisSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE uis_sync_state
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
