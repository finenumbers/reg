/**
 * One Voximplant stage. The key save, the access check, and the walk share one holder.
 * The key save and the access check do not take the database lease.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  parseCredentials,
  CREDENTIALS_UNREAD,
  type VoximplantCredentials,
} from "@/modules/voximplant/auth";
import { createVoximplantClient } from "@/modules/voximplant/client";
import {
  endVoximplant,
  isVoximplantActive,
  isVoximplantStopping,
  tryBeginVoximplant,
} from "@/modules/voximplant/lease";
import {
  appendVoximplantLog,
  beginVoximplantLog,
  flushVoximplantLog,
  sanitizeLogLine,
  voximplantLogExists,
} from "@/modules/voximplant/log";
import {
  dropPurchasedOverlap,
  dropPurchasedStage,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceVoximplantCatalogs,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/voximplant/publish";
import { FREE_COUNT, PURCHASED_COUNT, VOXIMPLANT_ORIGIN } from "@/modules/voximplant/url";
import { runAccessProbe, runVoximplantWalk, type Gate } from "@/modules/voximplant/walk";
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

export type VoximplantAccessView = {
  host: typeof VOXIMPLANT_ORIGIN;
  hasKey: boolean;
};

export type VoximplantSyncView = VoximplantAccessView & {
  busy: boolean;
  phase: string;
  list: string;
  pageDone: number;
  pageTotal: number;
  lastError: string | null;
  lastFree: number | null;
  lastPurchased: number | null;
  hasLog: boolean;
};

type Actor = { userId: string; ip?: string | null };
type ListName = "" | "purchased" | "free";

type StateRow = {
  phase: string;
  list: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  busy: boolean;
};

function emptySync(access: VoximplantAccessView, hasLog: boolean): VoximplantSyncView {
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
    hasLog,
  };
}

async function readAccess(): Promise<VoximplantAccessView> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "voximplantCredentialsCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  return { host: VOXIMPLANT_ORIGIN, hasKey: Boolean(rows[0]?.key) };
}

export async function getVoximplantAccessView(): Promise<VoximplantAccessView> {
  return readAccess();
}

export async function getVoximplantSyncView(): Promise<VoximplantSyncView> {
  const [access, rows, hasLog] = await Promise.all([
    readAccess(),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
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
      FROM voximplant_sync_state
      WHERE id = 1
    `,
    voximplantLogExists(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasLog);
  const busy = Boolean(state.busy) || isVoximplantActive();
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
    hasLog,
  };
}

async function loadCredentials(): Promise<VoximplantCredentials> {
  const rows = await prisma.$queryRaw<{ key: string | null }[]>`
    SELECT "voximplantCredentialsCiphertext" AS key
    FROM app_settings
    WHERE id = 1
  `;
  if (!rows[0]?.key) throw new Error(NO_KEY);
  const { deserializeEncryptedSecret, getSecretEncryptionService } =
    await import("@/modules/ssh/secrets");
  let text: string;
  try {
    text = getSecretEncryptionService().decrypt(deserializeEncryptedSecret(rows[0].key));
  } catch {
    throw new Error(BAD_SECRET);
  }
  const creds = parseCredentials(text);
  if (!creds) throw new Error(BAD_SECRET);
  return creds;
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE voximplant_sync_state
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
    UPDATE voximplant_sync_state
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
    UPDATE voximplant_sync_state
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
        UPDATE voximplant_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = ${list},
            page_done = ${pageDone},
            page_total = ${pageTotal}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM voximplant_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

function auditMeta(accountId: number, extra: Record<string, unknown>) {
  return { source: "voximplant", host: VOXIMPLANT_ORIGIN, accountId, ...extra };
}

export async function saveVoximplantAccess(
  credentials: string | undefined,
  actor: Actor,
): Promise<{ ok: true; settings: VoximplantAccessView } | { ok: false; error: string }> {
  const trimmed = credentials?.trim() ?? "";
  if (!trimmed) return { ok: true, settings: await readAccess() };
  const creds = parseCredentials(trimmed);
  if (!creds) return { ok: false, error: CREDENTIALS_UNREAD };
  armNumberingSyncStop();
  const begun = tryBeginVoximplant();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  try {
    const { getSecretEncryptionService, serializeEncryptedSecret } =
      await import("@/modules/ssh/secrets");
    const ciphertext = serializeEncryptedSecret(
      getSecretEncryptionService().encrypt(creds.blob),
    );
    const updated = await prisma.$executeRaw`
      UPDATE app_settings
      SET "voximplantCredentialsCiphertext" = ${ciphertext},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 1
    `;
    if (updated !== 1) return { ok: false, error: "Настройки не найдены." };
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.VOXIMPLANT_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: auditMeta(creds.accountId, { keyReplaced: true }),
    });
    return { ok: true, settings: await readAccess() };
  } finally {
    endVoximplant(begun.token);
  }
}

/** One purchased page, RU categories, then one free page when a region would be read. */
export async function testVoximplantAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginVoximplant();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  try {
    let creds: VoximplantCredentials;
    try {
      creds = await loadCredentials();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
    }
    const client = createVoximplantClient(creds);
    const result = await runAccessProbe(client);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.VOXIMPLANT_TEST,
      entityType: "voximplant",
      entityId: "voximplant",
      ip: actor.ip,
      meta: auditMeta(creds.accountId, { ok: result.ok }),
    });
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : BUSY };
  } finally {
    endVoximplant(holder);
  }
}

export async function startVoximplantSync(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const begun = tryBeginVoximplant();
  if (!begun.ok) {
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  }
  const holder = begun.token;
  let creds: VoximplantCredentials;
  try {
    creds = await loadCredentials();
  } catch (error) {
    endVoximplant(holder);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endVoximplant(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM voximplant_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endVoximplant(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginVoximplantLog();
  } catch {
    await release(runId).catch(() => undefined);
    endVoximplant(holder);
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
    if (isVoximplantStopping()) return "cancel";
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
  const client = createVoximplantClient(creds);

  void (async () => {
    try {
      const result = await runVoximplantWalk({
        beat: walkBeat,
        purchasedPage: (offset) => client.purchased(offset, PURCHASED_COUNT),
        purchasedRecount: () => client.purchasedRecount(),
        categories: () => client.categories(),
        regions: (category) => client.regions(category),
        freePage: (category, regionId, offset) =>
          client.free(category, regionId, offset, FREE_COUNT),
        freeRecount: (category, regionId) => client.freeRecount(category, regionId),
        stagePurchased: (dids) => stagePurchasedNumbers(runId, dids, keep),
        dropPurchased: () => dropPurchasedStage(runId),
        stageFree: async (rows) => {
          await stageFreeNumbers(runId, rows, keep);
        },
        log: (text) => appendVoximplantLog(`${text}\n`),
      });
      if (!result.ok) {
        await dropStage(runId).catch(() => undefined);
        const message =
          sanitizeLogLine(result.error) || "Загрузка прервана. Каталог не изменён.";
        await appendVoximplantLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
          () => undefined,
        );
        await flushVoximplantLog().catch(() => undefined);
        await finishError(runId, message);
        if (result.reason !== "lost") {
          await auditService
            .append({
              actorUserId: actor.userId,
              action: AUDIT_ACTIONS.VOXIMPLANT_SYNC,
              entityType: "voximplant",
              entityId: "voximplant",
              ip: actor.ip,
              meta: auditMeta(creds.accountId, { failed: true }),
            })
            .catch(() => undefined);
        }
        return;
      }

      const removed = await dropPurchasedOverlap(runId);
      if (removed > 0) {
        await appendVoximplantLog(
          `Совпадение: ${removed} номеров убраны из свободных, они куплены.\n`,
        );
      }
      await flushVoximplantLog();
      await fillDraftSplit(runId, keep);
      if (isVoximplantStopping()) throw new Error(CANCELLED);
      if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
      const marked = await markPublishing(runId);
      if (!marked) throw new SyncLost();
      if (isVoximplantStopping()) throw new Error(CANCELLED);
      let published: { free: number; purchased: number };
      try {
        published = await replaceVoximplantCatalogs(runId);
      } catch (error) {
        if (
          isLockTimeout(error) &&
          !(error instanceof SyncLost) &&
          !(error instanceof PublishMismatch) &&
          !isStatementTimeout(error)
        ) {
          await keep();
          if (isVoximplantStopping()) throw new Error(CANCELLED);
          published = await replaceVoximplantCatalogs(runId);
        } else {
          throw error;
        }
      }
      await appendVoximplantLog(
        `Итог: свободных ${published.free}, купленных ${published.purchased}\n`,
      ).catch(() => undefined);
      await flushVoximplantLog().catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.VOXIMPLANT_SYNC,
          entityType: "voximplant",
          entityId: "voximplant",
          ip: actor.ip,
          meta: auditMeta(creds.accountId, {
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
      await appendVoximplantLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushVoximplantLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
      if (!(error instanceof SyncLost)) {
        await auditService
          .append({
            actorUserId: actor.userId,
            action: AUDIT_ACTIONS.VOXIMPLANT_SYNC,
            entityType: "voximplant",
            entityId: "voximplant",
            ip: actor.ip,
            meta: auditMeta(creds.accountId, { failed: true }),
          })
          .catch(() => undefined);
      }
    } finally {
      await flushVoximplantLog().catch(() => undefined);
      endVoximplant(holder);
    }
  })();
  return { ok: true };
}

export async function cancelVoximplantSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE voximplant_sync_state
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
