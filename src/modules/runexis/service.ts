/**
 * One Runexis stage. Login, the showcase, and the partner list do not share SipOut's lease.
 * The token captured after login is not stored.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
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
import {
  runexisCodes,
  runexisLogin,
  runexisRead,
  runexisShowcaseSlice,
} from "@/modules/runexis/client";
import {
  endRunexis,
  isRunexisActive,
  isRunexisStopping,
  tryBeginRunexis,
} from "@/modules/runexis/lease";
import {
  appendRunexisLog,
  beginRunexisLog,
  flushRunexisLog,
  runexisLogExists,
  sanitizeLogLine,
} from "@/modules/runexis/log";
import {
  parseManagementPage,
  parseRegionCodes,
  parseSession,
  parseShowcasePage,
  rejectForeignCode,
  type RunexisSession,
} from "@/modules/runexis/parse";
import {
  dropPurchasedOverlap,
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceRunexisCatalogs,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/runexis/publish";
import { RUNEXIS_ORIGIN, SHOWCASE_LIMIT, type RunexisList } from "@/modules/runexis/url";
import { runRunexisWalk, type LeaseBeat } from "@/modules/runexis/walk";

const BUSY = "Уже выполняется.";
const STOPPING = "Сервер останавливается. Каталог не изменён.";
const NO_PASSWORD = "Пароль ещё не задан.";
const NO_EMAIL = "Email ещё не задан.";
const BAD_SECRET = "Пароль не читается.";
const BAD_LOGIN = "Площадка отклонила доступ.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";

export type RunexisAccessView = {
  host: typeof RUNEXIS_ORIGIN;
  email: string;
  hasPassword: boolean;
};

export type RunexisSyncView = RunexisAccessView & {
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

function emptySync(access: RunexisAccessView, hasLog: boolean): RunexisSyncView {
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

async function readAccess(): Promise<RunexisAccessView> {
  const rows = await prisma.$queryRaw<
    { email: string | null; password: string | null }[]
  >`
    SELECT "runexisEmail" AS email, "runexisPasswordCiphertext" AS password
    FROM app_settings
    WHERE id = 1
  `;
  const row = rows[0];
  return {
    host: RUNEXIS_ORIGIN,
    email: row?.email ?? "",
    hasPassword: Boolean(row?.password),
  };
}

export async function getRunexisAccessView(): Promise<RunexisAccessView> {
  return readAccess();
}

export async function getRunexisSyncView(): Promise<RunexisSyncView> {
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
      FROM runexis_sync_state
      WHERE id = 1
    `,
    runexisLogExists(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasLog);
  const busy = Boolean(state.busy) || isRunexisActive();
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

async function loadPassword(): Promise<{ email: string; password: string }> {
  const rows = await prisma.$queryRaw<
    { email: string | null; password: string | null }[]
  >`
    SELECT "runexisEmail" AS email, "runexisPasswordCiphertext" AS password
    FROM app_settings
    WHERE id = 1
  `;
  const row = rows[0];
  const email = row?.email?.trim() ?? "";
  if (!email) throw new Error(NO_EMAIL);
  if (!row?.password) throw new Error(NO_PASSWORD);
  const { deserializeEncryptedSecret, getSecretEncryptionService } =
    await import("@/modules/ssh/secrets");
  try {
    return {
      email,
      password: getSecretEncryptionService().decrypt(
        deserializeEncryptedSecret(row.password),
      ),
    };
  } catch {
    throw new Error(BAD_SECRET);
  }
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE runexis_sync_state
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
    UPDATE runexis_sync_state
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
    UPDATE runexis_sync_state
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
  page: number,
  total: number,
  list: RunexisList | "",
  accepted = 0,
): Promise<LeaseBeat> {
  const pageDone = list === "showcase" ? accepted : page;
  const pages =
    list === "showcase" ? 0 : total === 0 ? 1 : Math.ceil(total / SHOWCASE_LIMIT);
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE runexis_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = ${list},
            page_done = ${pageDone},
            page_total = ${pages}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM runexis_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

export async function saveRunexisAccess(
  input: { email?: string; password?: string },
  actor: Actor,
): Promise<{ ok: true; settings: RunexisAccessView } | { ok: false; error: string }> {
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";
  if (!email && !password) return { ok: true, settings: await readAccess() };
  if (!email) return { ok: false, error: NO_EMAIL };
  armNumberingSyncStop();
  const begun = tryBeginRunexis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  try {
    const current = await readAccess();
    let ciphertext: string | null = null;
    if (password) {
      const { getSecretEncryptionService, serializeEncryptedSecret } =
        await import("@/modules/ssh/secrets");
      ciphertext = serializeEncryptedSecret(
        getSecretEncryptionService().encrypt(password),
      );
    }
    if (ciphertext) {
      await prisma.$executeRaw`
        UPDATE app_settings
        SET "runexisEmail" = ${email},
            "runexisPasswordCiphertext" = ${ciphertext}
        WHERE id = 1
      `;
    } else {
      if (!current.hasPassword) return { ok: false, error: NO_PASSWORD };
      await prisma.$executeRaw`
        UPDATE app_settings
        SET "runexisEmail" = ${email}
        WHERE id = 1
      `;
    }
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.RUNEXIS_SAVE,
      entityType: "app_settings",
      entityId: "1",
      ip: actor.ip,
      meta: { source: "runexis", passwordReplaced: Boolean(password) },
    });
    return { ok: true, settings: await readAccess() };
  } finally {
    endRunexis(begun.token);
  }
}

async function loginSession(): Promise<
  { ok: true; session: RunexisSession } | { ok: false; error: string }
> {
  let creds: { email: string; password: string };
  try {
    creds = await loadPassword();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : NO_PASSWORD };
  }
  const page = await runexisLogin(creds.email, creds.password);
  if (!page.ok) return { ok: false, error: page.error };
  const session = parseSession(page.data);
  if (!session) return { ok: false, error: BAD_LOGIN };
  return { ok: true, session };
}

/** Login, the first partner page, the code directory, and one filtered showcase page. */
export async function testRunexisAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginRunexis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const token = begun.token;
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) return { ok: false, error: BUSY };
    const opened = await loginSession();
    if (!opened.ok) return opened;
    const keep = async () => {
      const state = await beat(runId, 0, 0, "");
      if (state !== "ok") throw new Error(BUSY);
    };
    const management = await runexisRead(opened.session, "management", 1, { beat: keep });
    const bought = management.ok ? parseManagementPage(management.data) : null;
    const codes = bought?.ok ? await runexisCodes(opened.session, { beat: keep }) : null;
    const directory = codes?.ok ? parseRegionCodes(codes.data) : null;
    const first = directory?.ok ? directory.slices[0] : undefined;
    const showcase = first
      ? await runexisShowcaseSlice(opened.session, 1, first, { beat: keep })
      : null;
    const free = showcase?.ok ? parseShowcasePage(showcase.data) : null;
    const foreign =
      free?.ok && first ? rejectForeignCode(free.page.rows, first.code) : null;
    const ok = Boolean(bought?.ok && directory?.ok && free?.ok && !foreign);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.RUNEXIS_TEST,
      entityType: "runexis",
      entityId: "runexis",
      ip: actor.ip,
      meta: { source: "runexis", ok },
    });
    if (!management.ok) return { ok: false, error: management.error };
    if (!bought?.ok) return { ok: false, error: bought?.error ?? BAD_LOGIN };
    if (!codes?.ok) return { ok: false, error: codes?.error ?? BAD_LOGIN };
    if (!directory?.ok) return { ok: false, error: directory?.error ?? BAD_LOGIN };
    if (!showcase?.ok) return { ok: false, error: showcase?.error ?? BAD_LOGIN };
    if (!free?.ok) return { ok: false, error: free?.error ?? BAD_LOGIN };
    if (foreign) return { ok: false, error: foreign };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : BAD_LOGIN,
    };
  } finally {
    if (claimed) await release(runId).catch(() => undefined);
    endRunexis(token);
  }
}

export async function startRunexisSync(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const begun = tryBeginRunexis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const holder = begun.token;
  const opened = await loginSession();
  if (!opened.ok) {
    endRunexis(holder);
    return opened;
  }
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endRunexis(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`
      DELETE FROM runexis_sync_stage WHERE run_id <> ${runId}
    `;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endRunexis(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginRunexisLog(runId);
  } catch {
    await release(runId).catch(() => undefined);
    endRunexis(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }
  const session = opened.session;
  let seenList: RunexisList = "management";
  let seenPage = 0;
  let seenTotal = 0;
  let seenAccepted = 0;
  const keep = async () => {
    const state = await beat(runId, seenPage, seenTotal, seenList, seenAccepted);
    if (state === "cancel") throw new Error("Загрузка отменена. Каталог не изменён.");
    if (state === "lost") throw new SyncLost();
  };
  void (async () => {
    try {
      const result = await runRunexisWalk({
        codes: () => runexisCodes(session, { beat: keep }),
        showcase: (page, slice) =>
          runexisShowcaseSlice(session, page, slice, { beat: keep }),
        management: (page) => runexisRead(session, "management", page, { beat: keep }),
        stillMine: async () => {
          if (isRunexisStopping()) return "cancel";
          return beat(runId, seenPage, seenTotal, seenList, seenAccepted);
        },
        stopping: isRunexisStopping,
        stageFree: (rows) => stageFreeNumbers(runId, rows),
        stagePurchased: async (dids) => {
          await stagePurchasedNumbers(runId, dids);
        },
        prepare: async () => {
          const removed = await dropPurchasedOverlap(runId);
          if (removed > 0) {
            await appendRunexisLog(
              `Совпадение: ${removed} номеров убраны из свободных, они куплены.\n`,
            ).catch(() => undefined);
          }
          await flushRunexisLog().catch(() => undefined);
          await fillDraftSplit(runId, async () => {
            const state = await beat(
              runId,
              seenPage,
              seenTotal,
              "showcase",
              seenAccepted,
            );
            if (state === "cancel")
              throw new Error("Загрузка отменена. Каталог не изменён.");
            if (state === "lost") throw new SyncLost();
          });
        },
        publish: async () => {
          if (isRunexisStopping())
            throw new Error("Загрузка отменена. Каталог не изменён.");
          if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
          const marked = await markPublishing(runId);
          if (!marked) throw new SyncLost();
          if (isRunexisStopping())
            throw new Error("Загрузка отменена. Каталог не изменён.");
          try {
            return await replaceRunexisCatalogs(runId);
          } catch (error) {
            if (
              isLockTimeout(error) &&
              !(error instanceof SyncLost) &&
              !(error instanceof PublishMismatch) &&
              !isStatementTimeout(error)
            ) {
              const state = await beat(
                runId,
                seenPage,
                seenTotal,
                seenList,
                seenAccepted,
              );
              if (state !== "ok") throw new SyncLost();
              if (isRunexisStopping())
                throw new Error("Загрузка отменена. Каталог не изменён.");
              return replaceRunexisCatalogs(runId);
            }
            throw error;
          }
        },
        dropStage: () => dropStage(runId),
        progress: async (list, page, total, accepted) => {
          seenList = list;
          seenPage = page;
          seenTotal = total;
          seenAccepted = accepted;
          const state = await beat(runId, page, total, list, accepted);
          if (state === "cancel")
            throw new Error("Загрузка отменена. Каталог не изменён.");
          if (state === "lost") throw new SyncLost();
        },
        log: (block) => appendRunexisLog(block),
        flushLog: () => flushRunexisLog(),
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
            action: AUDIT_ACTIONS.RUNEXIS_FREE,
            entityType: "runexis",
            entityId: "runexis",
            ip: actor.ip,
            meta: result.ok
              ? { source: "runexis", free: result.free, purchased: result.purchased }
              : { source: "runexis", failed: true },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message =
        (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
        "Не удалось записать номера.";
      await appendRunexisLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushRunexisLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
    } finally {
      endRunexis(holder);
    }
  })();
  return { ok: true };
}

export async function cancelRunexisSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE runexis_sync_state
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
