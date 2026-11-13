/**
 * One SipOut stage. The key captured at the start is not reread.
 * Reading SipOut and filling the draft do not hold a catalog lock.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { isLockTimeout, isStatementTimeout, withDbRetry } from "@/modules/numbering-sync/db-retry";
import { SyncLost } from "@/modules/numbering-sync/errors";
import {
  armNumberingSyncStop,
  endNumberingSync,
  isNumberingSyncActive,
  isNumberingSyncStopping,
  tryBeginNumberingSync,
} from "@/modules/numbering-sync/lease";
import {
  appendSipoutLog,
  beginSipoutLog,
  sanitizeLogLine,
  sipoutLogExists,
} from "@/modules/numbering-sync/log";
import {
  draftSummary,
  dropForeignStage,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceSipoutCatalogs,
  stageNumbers,
  type PublishCounts,
} from "@/modules/numbering-sync/publish";
import { runSourceWalk, type LeaseBeat } from "@/modules/numbering-sync/walk";
import { sipoutGet } from "@/modules/sipout/client";
import { SIPOUT_ORIGIN } from "@/modules/sipout/url";
import { CDR_VACUUM_BUSY_MESSAGE, isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

const BUSY = "Уже выполняется.";
const STOPPING = "Сервер останавливается. Каталог не изменён.";
const NO_KEY = "Ключ ещё не задан.";
const BAD_KEY = "Ключ не читается.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";

export type NumberingSyncView = {
  host: typeof SIPOUT_ORIGIN;
  hasKey: boolean;
  busy: boolean;
  phase: string;
  step: string | null;
  citiesDone: number;
  citiesTotal: number;
  lastError: string | null;
  lastFree: number | null;
  lastPurchased: number | null;
  hasLog: boolean;
};

type Actor = { userId: string; ip?: string | null };

type StateRow = {
  phase: string;
  catalog: string | null;
  cities_done: number;
  cities_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  busy: boolean;
};

function emptyView(hasKey: boolean, hasLog: boolean): NumberingSyncView {
  return {
    host: SIPOUT_ORIGIN,
    hasKey,
    busy: false,
    phase: "",
    step: null,
    citiesDone: 0,
    citiesTotal: 0,
    lastError: null,
    lastFree: null,
    lastPurchased: null,
    hasLog,
  };
}

export async function getNumberingSyncView(): Promise<NumberingSyncView> {
  const [settings, rows, hasLog] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { id: 1 },
      select: { sipoutApiKeyCiphertext: true },
    }),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, catalog, cities_done, cities_total, last_error,
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
      FROM numbering_sync_state
      WHERE id = 1
    `,
    sipoutLogExists(),
  ]);
  const state = rows[0];
  const hasKey = Boolean(settings?.sipoutApiKeyCiphertext);
  if (!state) return emptyView(hasKey, hasLog);
  const busy = Boolean(state.busy) || isNumberingSyncActive();
  return {
    host: SIPOUT_ORIGIN,
    hasKey,
    busy,
    phase: busy ? state.phase : "",
    step: busy ? state.catalog : null,
    citiesDone: busy ? state.cities_done : 0,
    citiesTotal: busy ? state.cities_total : 0,
    lastError: state.last_error,
    lastFree: state.last_free_written,
    lastPurchased: state.last_purchased_written,
    hasLog,
  };
}

export async function loadSipoutKey(): Promise<string> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { sipoutApiKeyCiphertext: true },
  });
  if (!row?.sipoutApiKeyCiphertext) throw new Error(NO_KEY);
  const { deserializeEncryptedSecret, getSecretEncryptionService } = await import(
    "@/modules/ssh/secrets"
  );
  try {
    return getSecretEncryptionService().decrypt(
      deserializeEncryptedSecret(row.sipoutApiKeyCiphertext),
    );
  } catch {
    throw new Error(BAD_KEY);
  }
}

async function claim(runId: string, catalog: string): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      INSERT INTO numbering_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING
    `;
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE numbering_sync_state
      SET run_id = ${runId},
          catalog = ${catalog},
          phase = 'running',
          cities_done = 0,
          cities_total = 0,
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
    UPDATE numbering_sync_state
    SET run_id = NULL,
        catalog = NULL,
        phase = '',
        cities_done = 0,
        cities_total = 0,
        heartbeat_at = NULL
    WHERE id = 1 AND run_id = ${runId}
  `;
}

async function finishError(runId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_sync_state
    SET run_id = NULL,
        catalog = NULL,
        phase = '',
        cities_done = 0,
        cities_total = 0,
        error = NULL,
        heartbeat_at = NULL,
        last_catalog = 'sipout',
        last_error = ${error},
        last_finished_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND run_id = ${runId}
  `;
}

function beat(runId: string, step: string, done: number, total: number): Promise<LeaseBeat> {
  return withDbRetry(() => prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<{ phase: string }[]>`
      UPDATE numbering_sync_state
      SET heartbeat_at = CURRENT_TIMESTAMP,
          cities_done = ${done},
          cities_total = ${total},
          catalog = CASE WHEN phase = 'publishing' THEN catalog ELSE ${step} END
      WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
      RETURNING phase
    `;
    if (updated.length === 1) return "ok";
    const left = await tx.$queryRaw<{ phase: string }[]>`
      SELECT phase FROM numbering_sync_state WHERE id = 1 AND run_id = ${runId}
    `;
    if (left[0]?.phase === "cancel") return "cancel";
    return "lost";
  }));
}

async function publishWithRetry(
  runId: string,
  done: number,
  total: number,
): Promise<PublishCounts> {
  if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
  const marked = await markPublishing(runId);
  if (!marked) throw new SyncLost();
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await replaceSipoutCatalogs(runId);
    } catch (error) {
      last = error;
      const retry =
        attempt < 3 &&
        isLockTimeout(error) &&
        !(error instanceof SyncLost) &&
        !(error instanceof PublishMismatch) &&
        !isStatementTimeout(error);
      if (!retry) throw error;
      const state = await beat(runId, "publishing", done, total);
      if (state !== "ok") throw new SyncLost();
    }
  }
  throw last;
}

export async function startSipoutSync(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const begun = tryBeginNumberingSync();
  if (!begun.ok) return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const token = begun.token;
  let key: string;
  try {
    key = await loadSipoutKey();
  } catch (error) {
    endNumberingSync(token);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId, "cities");
    if (!claimed) {
      endNumberingSync(token);
      return { ok: false, error: BUSY };
    }
    await dropForeignStage(runId);
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endNumberingSync(token);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginSipoutLog(runId);
  } catch {
    await release(runId).catch(() => undefined);
    endNumberingSync(token);
    return { ok: false, error: LOG_OPEN_FAILED };
  }
  let done = 0;
  let total = 0;
  let step = "cities";
  void (async () => {
    try {
      const result = await runSourceWalk({
        getCities: () => sipoutGet(key, { action: "get_cities" }),
        freeList: (cityId) => sipoutGet(key, { action: "free_list", cityId }),
        connectedList: () => sipoutGet(key, { action: "connected_list" }),
        stillMine: async () => {
          if (isNumberingSyncStopping()) return "cancel";
          return beat(runId, step, done, total);
        },
        stage: (catalog, dids) => stageNumbers(runId, catalog, dids),
        prepare: async () => {
          await fillDraftSplit(runId, async () => {
            const state = await beat(runId, "split", done, total);
            if (state === "cancel") throw new Error("Загрузка отменена. Каталог не изменён.");
            if (state === "lost") throw new SyncLost();
          });
          const summary = await draftSummary(runId);
          await appendSipoutLog(
            [
              "--- Черновик ---",
              `Свободных: ${summary.free}`,
              `Купленных: ${summary.purchased}`,
              `Номеров в обоих списках: ${summary.overlap}`,
              "",
            ].join("\n"),
          );
        },
        publish: () => publishWithRetry(runId, done, total),
        dropStage: () => dropStage(runId),
        progress: async (nextStep, nextDone, nextTotal) => {
          step = nextStep;
          done = nextDone;
          total = nextTotal;
          await beat(runId, step, done, total);
        },
        log: (block) => appendSipoutLog(block),
      });
      if (!result.ok) {
        const message =
          result.reason === "lost"
            ? "Загрузка прервана. Каталог не изменён."
            : result.error || "Загрузка отменена. Каталог не изменён.";
        await finishError(runId, message);
      }
      if (result.ok || result.reason !== "lost") {
        await auditService
          .append({
            actorUserId: actor.userId,
            action: AUDIT_ACTIONS.NUMBERING_SYNC_SOURCE,
            entityType: "numbering_sync",
            entityId: "sipout",
            ip: actor.ip,
            meta: result.ok
              ? {
                  source: "sipout",
                  free: result.counts.insertedFree,
                  purchased: result.counts.insertedPurchased,
                }
              : { source: "sipout", failed: true },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message =
        (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
        "Не удалось записать номера.";
      await appendSipoutLog(`Итог: каталоги не изменены\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await finishError(runId, message).catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.NUMBERING_SYNC_SOURCE,
          entityType: "numbering_sync",
          entityId: "sipout",
          ip: actor.ip,
          meta: { source: "sipout", failed: true },
        })
        .catch(() => undefined);
    } finally {
      endNumberingSync(token);
    }
  })();
  return { ok: true };
}

export async function cancelSipoutSync(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE numbering_sync_state
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

export type SipoutAccessView = {
  host: typeof SIPOUT_ORIGIN;
  hasKey: boolean;
};

export async function getSipoutAccessView(): Promise<SipoutAccessView> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { sipoutApiKeyCiphertext: true },
  });
  return { host: SIPOUT_ORIGIN, hasKey: Boolean(row?.sipoutApiKeyCiphertext) };
}

export async function saveSipoutKey(
  token: string | undefined,
  actor: Actor,
): Promise<{ ok: true; settings: SipoutAccessView } | { ok: false; error: string }> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return { ok: true, settings: await getSipoutAccessView() };
  armNumberingSyncStop();
  const begun = tryBeginNumberingSync();
  if (!begun.ok) return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  try {
    const { getSecretEncryptionService, serializeEncryptedSecret } = await import(
      "@/modules/ssh/secrets"
    );
    const ciphertext = serializeEncryptedSecret(getSecretEncryptionService().encrypt(trimmed));
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, sipoutApiKeyCiphertext: ciphertext },
      update: { sipoutApiKeyCiphertext: ciphertext },
    });
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.NUMBERING_SYNC_KEY_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: { source: "sipout", keyReplaced: true },
    });
    return { ok: true, settings: await getSipoutAccessView() };
  } finally {
    endNumberingSync(begun.token);
  }
}

/** One get_cities. Does not write catalogs and does not rewrite the stage log. */
export async function testSipoutAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginNumberingSync();
  if (!begun.ok) return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const token = begun.token;
  let key: string;
  try {
    key = await loadSipoutKey();
  } catch (error) {
    endNumberingSync(token);
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  const claimed = await claim(runId, "check");
  if (!claimed) {
    endNumberingSync(token);
    return { ok: false, error: BUSY };
  }
  try {
    const page = await sipoutGet(key, { action: "get_cities" });
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.NUMBERING_SYNC_TEST,
      entityType: "numbering_sync",
      entityId: "sipout",
      ip: actor.ip,
      meta: { source: "sipout", ok: page.ok },
    });
    return page.ok ? { ok: true } : { ok: false, error: page.error };
  } finally {
    await release(runId);
    endNumberingSync(token);
  }
}

export function claimFailureIsBusy(error: unknown): boolean {
  return isLockTimeout(error);
}
