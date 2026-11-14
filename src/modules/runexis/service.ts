/**
 * One Runexis free-number stage. Login and the showcase do not share SipOut's lease.
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
import { runexisLogin, runexisShowcase } from "@/modules/runexis/client";
import {
  endRunexis,
  isRunexisActive,
  isRunexisStopping,
  tryBeginRunexis,
} from "@/modules/runexis/lease";
import {
  appendRunexisLog,
  beginRunexisLog,
  runexisLogExists,
  sanitizeLogLine,
} from "@/modules/runexis/log";
import { parseAccessToken } from "@/modules/runexis/parse";
import {
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceRunexisFree,
  stageNumbers,
  SyncLost,
} from "@/modules/runexis/publish";
import { RUNEXIS_ORIGIN, SHOWCASE_LIMIT } from "@/modules/runexis/url";
import { runFreeWalk, type LeaseBeat } from "@/modules/runexis/walk";

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
  pageDone: number;
  pageTotal: number;
  lastError: string | null;
  lastFree: number | null;
  hasLog: boolean;
};

type Actor = { userId: string; ip?: string | null };

type StateRow = {
  phase: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  busy: boolean;
};

function emptySync(access: RunexisAccessView, hasLog: boolean): RunexisSyncView {
  return {
    ...access,
    busy: false,
    phase: "",
    pageDone: 0,
    pageTotal: 0,
    lastError: null,
    lastFree: null,
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
      SELECT phase, page_done, page_total, last_error, last_free_written,
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
    pageDone: busy ? state.page_done : 0,
    pageTotal: busy ? state.page_total : 0,
    lastError: state.last_error,
    lastFree: state.last_free_written,
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
        page_done = 0,
        page_total = 0,
        error = NULL,
        heartbeat_at = NULL,
        last_error = ${error},
        last_finished_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND run_id = ${runId}
  `;
}

function beat(runId: string, page: number, total: number): Promise<LeaseBeat> {
  const pages = total === 0 ? 1 : Math.ceil(total / SHOWCASE_LIMIT);
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE runexis_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            page_done = ${page},
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

async function loginToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  let creds: { email: string; password: string };
  try {
    creds = await loadPassword();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : NO_PASSWORD };
  }
  const page = await runexisLogin(creds.email, creds.password);
  if (!page.ok) return { ok: false, error: page.error };
  const token = parseAccessToken(page.data);
  if (!token) return { ok: false, error: BAD_LOGIN };
  return { ok: true, token };
}

/** One login and one showcase page. Does not write the catalog or the stage log. */
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
    const session = await loginToken();
    if (!session.ok) return session;
    const page = await runexisShowcase(session.token, 1);
    await auditService.append({
      actorUserId: actor.userId,
      action: AUDIT_ACTIONS.RUNEXIS_TEST,
      entityType: "runexis",
      entityId: "runexis",
      ip: actor.ip,
      meta: { source: "runexis", ok: page.ok },
    });
    return page.ok ? { ok: true } : { ok: false, error: page.error };
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
  const session = await loginToken();
  if (!session.ok) {
    endRunexis(holder);
    return session;
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
  const accessToken = session.token;
  let seenPage = 0;
  let seenTotal = 0;
  void (async () => {
    try {
      const result = await runFreeWalk({
        showcase: (page) => runexisShowcase(accessToken, page),
        stillMine: async () => {
          if (isRunexisStopping()) return "cancel";
          return beat(runId, seenPage, seenTotal);
        },
        stopping: isRunexisStopping,
        stage: async (dids) => {
          await stageNumbers(runId, dids);
        },
        prepare: async () => {
          await fillDraftSplit(runId, async () => {
            const state = await beat(runId, 0, 0);
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
            return await replaceRunexisFree(runId);
          } catch (error) {
            if (
              isLockTimeout(error) &&
              !(error instanceof SyncLost) &&
              !(error instanceof PublishMismatch) &&
              !isStatementTimeout(error)
            ) {
              const state = await beat(runId, seenPage, seenTotal);
              if (state !== "ok") throw new SyncLost();
              if (isRunexisStopping())
                throw new Error("Загрузка отменена. Каталог не изменён.");
              return replaceRunexisFree(runId);
            }
            throw error;
          }
        },
        dropStage: () => dropStage(runId),
        progress: async (page, total) => {
          seenPage = page;
          seenTotal = total;
          const state = await beat(runId, page, total);
          if (state === "cancel")
            throw new Error("Загрузка отменена. Каталог не изменён.");
          if (state === "lost") throw new SyncLost();
        },
        log: (block) => appendRunexisLog(block),
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
              ? { source: "runexis", free: result.inserted }
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
