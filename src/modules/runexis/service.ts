/**
 * One Runexis list. Login happens once for that list.
 * The token captured after login is not stored. The lease is not shared with SipOut.
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
  type RunexisLogSide,
} from "@/modules/runexis/log";
import {
  parseManagementPage,
  parseRegionCodes,
  parseSession,
  parseShowcasePage,
  rejectForeignCode,
  SHORT_PAGE,
  showcasePageIsFull,
  type RunexisSession,
} from "@/modules/runexis/parse";
import {
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceRunexisFree,
  replaceRunexisPurchased,
  stageFreeNumbers,
  stagePurchasedNumbers,
  SyncLost,
} from "@/modules/runexis/publish";
import {
  MANAGEMENT_LIMIT,
  RUNEXIS_ORIGIN,
  type RunexisList,
} from "@/modules/runexis/url";
import {
  runRunexisFreeWalk,
  runRunexisPurchasedWalk,
  type LeaseBeat,
} from "@/modules/runexis/walk";

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
  freeShown: number | null;
  purchasedShown: number | null;
  purchasedLoadedAtLabel: string;
  freeLoadedAtLabel: string;
  hasPurchasedLog: boolean;
  hasFreeLog: boolean;
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
  purchased_loaded_at: Date | null;
  free_loaded_at: Date | null;
  staged_free: number;
  staged_purchased: number;
  busy: boolean;
};

function emptySync(
  access: RunexisAccessView,
  hasPurchasedLog: boolean,
  hasFreeLog: boolean,
): RunexisSyncView {
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
  const [access, rows, hasPurchasedLog, hasFreeLog, timeZone] = await Promise.all([
    readAccess(),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, list, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        purchased_loaded_at, free_loaded_at,
        (
          SELECT count(*)::int FROM runexis_sync_stage AS stage
          WHERE stage.run_id = runexis_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM runexis_sync_stage AS stage
          WHERE stage.run_id = runexis_sync_state.run_id
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
      FROM runexis_sync_state
      WHERE id = 1
    `,
    runexisLogExists("purchased"),
    runexisLogExists("free"),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  if (!state) return emptySync(access, hasPurchasedLog, hasFreeLog);
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
    list === "showcase" ? 0 : total === 0 ? 1 : Math.ceil(total / MANAGEMENT_LIMIT);
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

async function openRunexisSession(creds: {
  email: string;
  password: string;
}): Promise<{ ok: true; session: RunexisSession } | { ok: false; error: string }> {
  const page = await runexisLogin(creds.email, creds.password);
  if (!page.ok) return { ok: false, error: page.error };
  const session = parseSession(page.data);
  if (!session) return { ok: false, error: BAD_LOGIN };
  return { ok: true, session };
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
  return openRunexisSession(creds);
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
    const full =
      free?.ok === true && showcasePageIsFull(free.page.total, free.page.rows.length);
    const ok = Boolean(bought?.ok && directory?.ok && free?.ok && !foreign && full);
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
    if (!full) return { ok: false, error: SHORT_PAGE };
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

export function startRunexisPurchased(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return startRunexisSide(actor, options, "purchased");
}

export function startRunexisFree(
  actor: Actor,
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return startRunexisSide(actor, options, "free");
}

async function startRunexisSide(
  actor: Actor,
  options: { fromChain?: boolean } | undefined,
  side: RunexisLogSide,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  let creds: { email: string; password: string };
  try {
    creds = await loadPassword();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : NO_PASSWORD };
  }
  const begun = tryBeginRunexis();
  if (!begun.ok)
    return { ok: false, error: begun.reason === "stopping" ? STOPPING : BUSY };
  const holder = begun.token;
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
  let opened: { ok: true; session: RunexisSession } | { ok: false; error: string };
  try {
    opened = await openRunexisSession(creds);
  } catch (error) {
    await release(runId).catch(() => undefined);
    endRunexis(holder);
    return { ok: false, error: error instanceof Error ? error.message : BAD_LOGIN };
  }
  if (!opened.ok) {
    await release(runId).catch(() => undefined);
    endRunexis(holder);
    return opened;
  }
  try {
    await beginRunexisLog(runId, side);
  } catch {
    await release(runId).catch(() => undefined);
    endRunexis(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }
  const session = opened.session;
  let seenList: RunexisList = side === "purchased" ? "management" : "showcase";
  let seenPage = 0;
  let seenTotal = 0;
  let seenAccepted = 0;
  const keep = async () => {
    const state = await beat(runId, seenPage, seenTotal, seenList, seenAccepted);
    if (state === "cancel") throw new Error("Загрузка отменена. Каталог не изменён.");
    if (state === "lost") throw new SyncLost();
  };
  const walk = side === "purchased" ? runRunexisPurchasedWalk : runRunexisFreeWalk;
  const replace = side === "purchased" ? replaceRunexisPurchased : replaceRunexisFree;
  void (async () => {
    try {
      const refused = (): Promise<never> => Promise.reject(new SyncLost());
      const result = await walk({
        codes: side === "free" ? () => runexisCodes(session, { beat: keep }) : refused,
        showcase:
          side === "free"
            ? (page, slice) => runexisShowcaseSlice(session, page, slice, { beat: keep })
            : refused,
        management:
          side === "purchased"
            ? (page) => runexisRead(session, "management", page, { beat: keep })
            : refused,
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
          await fillDraftSplit(runId, async () => {
            const state = await beat(runId, seenPage, seenTotal, seenList, seenAccepted);
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
            return await replace(runId);
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
              return replace(runId);
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
            action:
              side === "purchased"
                ? AUDIT_ACTIONS.RUNEXIS_PURCHASED
                : AUDIT_ACTIONS.RUNEXIS_FREE,
            entityType: "runexis",
            entityId: "runexis",
            ip: actor.ip,
            meta: result.ok
              ? { source: "runexis", side, inserted: result.inserted }
              : { source: "runexis", side, failed: true },
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
