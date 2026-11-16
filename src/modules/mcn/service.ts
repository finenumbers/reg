/**
 * One MCN Telecom stage. The key save, the access check, and the walk share one holder.
 * The key save and the access check do not take the database lease.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { cardLabels } from "@/modules/numbering-sync/card-numbers";
import { getDisplayTimezone } from "@/modules/settings/service";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { chainStartBlock } from "@/modules/numbering-chain/gate";
import { createMcnClient } from "@/modules/mcn/client";
import { endMcn, isMcnActive, isMcnStopping, tryBeginMcn } from "@/modules/mcn/lease";
import {
  appendMcnLog,
  beginMcnLog,
  flushMcnLog,
  mcnLogExists,
  sanitizeLogLine,
} from "@/modules/mcn/log";
import {
  dropPurchasedOverlap,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceMcnCatalogs,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/mcn/publish";
import { PURCHASED_LIMIT, SHOP_HOST, VPBX_HOST } from "@/modules/mcn/url";
import { runAccessProbe, runMcnWalk, type Gate } from "@/modules/mcn/walk";
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
const BAD_TOKEN = "Проверьте ключ.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";

export type McnAccessView = {
  shopHost: typeof SHOP_HOST;
  vpbxHost: typeof VPBX_HOST;
  hasKey: boolean;
};

export type McnSyncView = McnAccessView & {
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
type ListName = "" | "purchased" | "free";

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

function hosts(): { shopHost: typeof SHOP_HOST; vpbxHost: typeof VPBX_HOST } {
  return { shopHost: SHOP_HOST, vpbxHost: VPBX_HOST };
}

function auditMeta(
  extra: Record<string, string | number | boolean>,
): Record<string, unknown> {
  return { source: "mcn", ...hosts(), ...extra };
}

function tokenReadable(value: string): boolean {
  return value.length >= 1 && value.length <= 4096 && !/[\r\n]/.test(value);
}

function emptySync(access: McnAccessView, hasLog: boolean): McnSyncView {
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

async function readAccess(): Promise<McnAccessView> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "mcnApiKeyCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  return { ...hosts(), hasKey: Boolean(rows[0]?.key) };
}

export async function getMcnAccessView(): Promise<McnAccessView> {
  return readAccess();
}

export async function getMcnSyncView(): Promise<McnSyncView> {
  const [access, rows, hasLog, timeZone] = await Promise.all([
    readAccess(),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        duplicates_dropped, loaded_at,
        (
          SELECT count(*)::int FROM mcn_sync_stage AS stage
          WHERE stage.run_id = mcn_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM mcn_sync_stage AS stage
          WHERE stage.run_id = mcn_sync_state.run_id
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
      FROM mcn_sync_state
      WHERE id = 1
    `,
    mcnLogExists(),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasLog);
  const busy = Boolean(state.busy) || isMcnActive();
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
    SELECT "mcnApiKeyCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  if (!rows[0]?.key) throw new Error(NO_KEY);
  const { deserializeEncryptedSecret, getSecretEncryptionService } =
    await import("@/modules/ssh/secrets");
  try {
    const token = getSecretEncryptionService().decrypt(
      deserializeEncryptedSecret(rows[0].key),
    );
    if (!tokenReadable(token)) throw new Error(BAD_SECRET);
    return token;
  } catch (error) {
    if (error instanceof Error && error.message === BAD_SECRET) throw error;
    throw new Error(BAD_SECRET);
  }
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE mcn_sync_state
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
    UPDATE mcn_sync_state
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
    UPDATE mcn_sync_state
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
        UPDATE mcn_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = ${list},
            page_done = ${pageDone},
            page_total = ${pageTotal}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM mcn_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

export async function saveMcnAccess(
  token: string | undefined,
  actor: Actor,
): Promise<{ ok: true; settings: McnAccessView } | { ok: false; error: string }> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return { ok: true, settings: await readAccess() };
  if (!tokenReadable(trimmed)) return { ok: false, error: BAD_TOKEN };
  armNumberingSyncStop();
  const begun = tryBeginMcn();
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
      SET "mcnApiKeyCiphertext" = ${ciphertext},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 1
    `;
    if (updated !== 1) return { ok: false, error: "Настройки не найдены." };
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.MCN_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: auditMeta({ keyReplaced: true }),
    });
    return { ok: true, settings: await readAccess() };
  } finally {
    endMcn(begun.token);
  }
}

/** One purchased page, the country directory, then one free page. No catalog write. */
export async function testMcnAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginMcn();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  try {
    let key: string;
    try {
      key = await loadKey();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
    }
    const client = createMcnClient(key);
    const result = await runAccessProbe(client);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.MCN_TEST,
      entityType: "mcn",
      entityId: "mcn",
      ip: actor.ip,
      meta: auditMeta({ ok: result.ok }),
    });
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : BUSY };
  } finally {
    endMcn(holder);
  }
}

export async function startMcnSync(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  const begun = tryBeginMcn();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  let key: string;
  try {
    key = await loadKey();
  } catch (error) {
    endMcn(holder);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endMcn(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM mcn_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endMcn(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginMcnLog();
  } catch {
    await release(runId).catch(() => undefined);
    endMcn(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }

  let seenList: ListName = "purchased";
  let seenDone = 0;
  let seenTotal = 0;
  const walkBeat = async (
    list: "purchased" | "free",
    pageDone: number,
    pageTotal: number,
  ): Promise<Gate> => {
    seenList = list;
    seenDone = pageDone;
    seenTotal = pageTotal;
    if (isMcnStopping()) return "cancel";
    const state = await beat(runId, seenDone, seenTotal, seenList);
    if (state === "ok") return "run";
    return state;
  };
  const keep = async () => {
    const state = await walkBeat(
      seenList === "free" ? "free" : "purchased",
      seenDone,
      seenTotal,
    );
    if (state === "cancel") throw new Error(CANCELLED);
    if (state === "lost") throw new SyncLost();
  };
  const client = createMcnClient(key);

  let duplicates = 0;
  void (async () => {
    try {
      const result = await runMcnWalk({
        beat: walkBeat,
        purchasedPage: (offset) => client.purchased(offset, PURCHASED_LIMIT),
        purchasedRecount: () => client.purchasedRecount(),
        countries: () => client.countries(),
        freePage: (countryCode, pageNumber) => client.free(countryCode, pageNumber),
        freeRecount: (countryCode) => client.freeRecount(countryCode),
        stagePurchased: (dids) => stagePurchasedNumbers(runId, dids, keep),
        stageFree: async (rows) => {
          const wrote = await stageFreeNumbers(runId, rows, keep);
          duplicates += wrote.skipped;
        },
        addDuplicates: (count) => {
          duplicates += count;
        },
        log: (text) => appendMcnLog(`${text}\n`),
      });
      if (!result.ok) {
        await dropStage(runId).catch(() => undefined);
        const message =
          sanitizeLogLine(result.error) || "Загрузка прервана. Каталог не изменён.";
        await appendMcnLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
          () => undefined,
        );
        await flushMcnLog().catch(() => undefined);
        await finishError(runId, message);
        if (result.reason !== "lost") {
          await auditService
            .append({
              actorUserId: actor.userId,
              action: AUDIT_ACTIONS.MCN_SYNC,
              entityType: "mcn",
              entityId: "mcn",
              ip: actor.ip,
              meta: auditMeta({ failed: true }),
            })
            .catch(() => undefined);
        }
        return;
      }

      const removed = await dropPurchasedOverlap(runId);
      duplicates += removed;
      if (removed > 0) {
        await appendMcnLog(
          `Совпадение: ${removed} номеров убраны из свободных, они куплены.\n`,
        );
      }
      await flushMcnLog();
      await fillDraftSplit(runId, keep);
      if (isMcnStopping()) throw new Error(CANCELLED);
      if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
      const marked = await markPublishing(runId);
      if (!marked) throw new SyncLost();
      if (isMcnStopping()) throw new Error(CANCELLED);
      let published: { free: number; purchased: number };
      try {
        published = await replaceMcnCatalogs(runId, duplicates);
      } catch (error) {
        if (
          isLockTimeout(error) &&
          !(error instanceof SyncLost) &&
          !(error instanceof PublishMismatch) &&
          !isStatementTimeout(error)
        ) {
          await keep();
          if (isMcnStopping()) throw new Error(CANCELLED);
          published = await replaceMcnCatalogs(runId, duplicates);
        } else {
          throw error;
        }
      }
      await appendMcnLog(
        `Итог: свободных ${published.free}, купленных ${published.purchased}\n`,
      ).catch(() => undefined);
      await flushMcnLog().catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.MCN_SYNC,
          entityType: "mcn",
          entityId: "mcn",
          ip: actor.ip,
          meta: auditMeta({
            free: published.free,
            purchased: published.purchased,
          }),
        })
        .catch(() => undefined);
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message =
        (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
        "Не удалось записать номера.";
      await appendMcnLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushMcnLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
      if (!(error instanceof SyncLost)) {
        await auditService
          .append({
            actorUserId: actor.userId,
            action: AUDIT_ACTIONS.MCN_SYNC,
            entityType: "mcn",
            entityId: "mcn",
            ip: actor.ip,
            meta: auditMeta({ failed: true }),
          })
          .catch(() => undefined);
      }
    } finally {
      await flushMcnLog().catch(() => undefined);
      endMcn(holder);
    }
  })();
  return { ok: true };
}

export async function cancelMcnSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE mcn_sync_state
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
