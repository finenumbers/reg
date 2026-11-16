/**
 * Aurora file save, the file check, and the walk share one holder.
 * Saving a file does not take the database lease and does not publish.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  addAuroraFile,
  displayFileName,
  dropCommittedInbox,
  listAuroraFiles,
  moveAuroraFile,
  parseAuroraSet,
  removeAuroraFile,
  type AuroraFileRow,
} from "@/modules/aurora/files";
import { endAurora, isAuroraActive, isAuroraStopping, tryBeginAurora } from "@/modules/aurora/lease";
import {
  appendAuroraLog,
  auroraLogExists,
  beginAuroraLog,
  flushAuroraLog,
  sanitizeLogLine,
} from "@/modules/aurora/log";
import { auroraFormatLabel, shouldPublishAurora } from "@/modules/aurora/parse";
import {
  dropStage,
  fillDraftSplit,
  markPublishing,
  PublishMismatch,
  replaceAuroraCatalogs,
  stageFreeNumbers,
  SyncLost,
} from "@/modules/aurora/publish";
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
const NO_FILES = "Файлы ещё не указаны.";
const EMPTY = "В файлах нет номеров. Каталог не изменён.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";

export type AuroraLoadView = {
  files: AuroraFileRow[];
  busy: boolean;
};

export type AuroraSyncView = {
  busy: boolean;
  phase: string;
  pageDone: number;
  pageTotal: number;
  lastError: string | null;
  lastFree: number | null;
  lastPurchased: number | null;
  hasLog: boolean;
  hasFiles: boolean;
};

type Actor = { userId: string; ip?: string | null };
type LeaseBeat = "ok" | "cancel" | "lost";

type StateRow = {
  phase: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  busy: boolean;
};

function heldError(reason: "busy" | "stopping"): string {
  return reason === "stopping" ? STOPPING : BUSY;
}

export async function getAuroraLoadView(): Promise<AuroraLoadView> {
  const files = await listAuroraFiles();
  return { files, busy: isAuroraActive() };
}

export async function getAuroraSyncView(): Promise<AuroraSyncView> {
  const [rows, hasLog, files] = await Promise.all([
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, page_done, page_total, last_error,
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
      FROM aurora_sync_state
      WHERE id = 1
    `,
    auroraLogExists(),
    listAuroraFiles(),
  ]);
  const state = rows[0];
  const busy = Boolean(state?.busy) || isAuroraActive();
  return {
    busy,
    phase: busy ? (state?.phase ?? "") : "",
    pageDone: busy ? (state?.page_done ?? 0) : 0,
    pageTotal: busy ? (state?.page_total ?? 0) : 0,
    lastError: state?.last_error ?? null,
    lastFree: state?.last_free_written ?? null,
    lastPurchased: state?.last_purchased_written ?? null,
    hasLog,
    hasFiles: files.length > 0,
  };
}

async function withHolder<T extends { ok: boolean }>(
  work: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  armNumberingSyncStop();
  const begun = tryBeginAurora();
  if (!begun.ok) return { ok: false, error: heldError(begun.reason) };
  try {
    return await work();
  } finally {
    endAurora(begun.token);
  }
}

export async function saveAuroraFile(
  input: { bytes: Uint8Array; displayName: string; format: string },
  actor: Actor,
): Promise<
  { ok: true; settings: AuroraLoadView; dropped?: number } | { ok: false; error: string }
> {
  const saved = await withHolder(() => addAuroraFile(input));
  if (!saved.ok) return saved;
  const parsed = await parseAuroraSet();
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.AURORA_SAVE,
    entityType: "aurora_files",
    entityId: "aurora",
    ip: actor.ip,
    meta: { name: displayFileName(input.displayName) ?? "", format: input.format },
  });
  return {
    ok: true,
    settings: await getAuroraLoadView(),
    ...(parsed.ok ? { dropped: parsed.dropped } : {}),
  };
}

export async function deleteAuroraFile(
  id: string,
  actor: Actor,
): Promise<{ ok: true; settings: AuroraLoadView } | { ok: false; error: string }> {
  const removed = await withHolder(() => removeAuroraFile(id));
  if (!removed.ok) return removed;
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.AURORA_SAVE,
    entityType: "aurora_files",
    entityId: "aurora",
    ip: actor.ip,
    meta: { removed: true },
  });
  return { ok: true, settings: await getAuroraLoadView() };
}

export async function reorderAuroraFile(
  id: string,
  direction: "up" | "down",
): Promise<{ ok: true; settings: AuroraLoadView } | { ok: false; error: string }> {
  const moved = await withHolder(() => moveAuroraFile(id, direction));
  if (!moved.ok) return moved;
  return { ok: true, settings: await getAuroraLoadView() };
}

export async function checkAuroraFiles(
  actor: Actor,
): Promise<
  { ok: true; read: number; kept: number; dropped: number } | { ok: false; error: string }
> {
  const checked = await withHolder(async () => {
    const parsed = await parseAuroraSet();
    if (!parsed.ok) return parsed;
    return {
      ok: true as const,
      read: parsed.read,
      kept: parsed.rows.length,
      dropped: parsed.dropped,
    };
  });
  if (!checked.ok) return checked;
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.AURORA_TEST,
    entityType: "aurora",
    entityId: "aurora",
    ip: actor.ip,
    meta: { kept: checked.kept, dropped: checked.dropped },
  });
  return checked;
}

async function claim(runId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE aurora_sync_state
      SET run_id = ${runId},
          phase = 'running',
          list = 'free',
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
    UPDATE aurora_sync_state
    SET run_id = NULL,
        phase = '',
        list = '',
        page_done = 0,
        page_total = 0,
        error = NULL,
        heartbeat_at = NULL
    WHERE id = 1 AND run_id = ${runId}
  `;
}

async function finishError(runId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE aurora_sync_state
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

function beat(runId: string, done: number, total: number): Promise<LeaseBeat> {
  return withDbRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ phase: string }[]>`
        UPDATE aurora_sync_state
        SET heartbeat_at = CURRENT_TIMESTAMP,
            list = 'free',
            page_done = ${done},
            page_total = ${total}
        WHERE id = 1 AND run_id = ${runId} AND phase IN ('running', 'publishing')
        RETURNING phase
      `;
      if (updated.length === 1) return "ok";
      const left = await tx.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM aurora_sync_state WHERE id = 1 AND run_id = ${runId}
      `;
      if (left[0]?.phase === "cancel") return "cancel";
      return "lost";
    }),
  );
}

export async function startAuroraSync(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const files = await listAuroraFiles();
  if (files.length === 0) return { ok: false, error: NO_FILES };
  const begun = tryBeginAurora();
  if (!begun.ok) return { ok: false, error: heldError(begun.reason) };
  const holder = begun.token;
  const runId = randomUUID();
  let claimed = false;
  try {
    claimed = await claim(runId);
    if (!claimed) {
      endAurora(holder);
      return { ok: false, error: BUSY };
    }
    await prisma.$executeRaw`DELETE FROM aurora_sync_stage WHERE run_id <> ${runId}`;
  } catch (error) {
    if (claimed) await release(runId).catch(() => undefined);
    endAurora(holder);
    if (isLockTimeout(error)) return { ok: false, error: BUSY };
    return { ok: false, error: START_FAILED };
  }
  try {
    await beginAuroraLog(runId);
  } catch {
    await release(runId).catch(() => undefined);
    endAurora(holder);
    return { ok: false, error: LOG_OPEN_FAILED };
  }
  let seenDone = 0;
  let seenTotal = files.length;
  void (async () => {
    try {
      const guard = async () => {
        if (isAuroraStopping()) throw new Error(CANCELLED);
        const state = await beat(runId, seenDone, seenTotal);
        if (state === "cancel") throw new Error(CANCELLED);
        if (state === "lost") throw new SyncLost();
      };
      const parsed = await parseAuroraSet();
      if (!parsed.ok) throw new Error(parsed.error);
      const listed = await listAuroraFiles();
      seenTotal = listed.length;
      seenDone = listed.length;
      await guard();
      for (const file of listed) {
        await appendAuroraLog(
          [
            `Файл: ${file.name}`,
            `Формат: ${auroraFormatLabel(file.format)}`,
            "",
          ].join("\n"),
        );
      }
      await appendAuroraLog(
        `Прочитано: ${parsed.read}\nОставлено: ${parsed.rows.length}\nПовторов отброшено: ${parsed.dropped}\n`,
      );
      await flushAuroraLog();
      if (!shouldPublishAurora(parsed.rows.length)) throw new Error(EMPTY);
      await stageFreeNumbers(runId, parsed.rows);
      await guard();
      await fillDraftSplit(runId, guard);
      if (isAuroraStopping()) throw new Error(CANCELLED);
      if (isDatabaseVacuumActive()) throw new Error(CDR_VACUUM_BUSY_MESSAGE);
      const marked = await markPublishing(runId);
      if (!marked) throw new SyncLost();
      if (isAuroraStopping()) throw new Error(CANCELLED);
      let counts: { free: number; purchased: number };
      try {
        counts = await replaceAuroraCatalogs(runId);
      } catch (error) {
        if (
          isLockTimeout(error) &&
          !(error instanceof SyncLost) &&
          !(error instanceof PublishMismatch) &&
          !isStatementTimeout(error)
        ) {
          await guard();
          counts = await replaceAuroraCatalogs(runId);
        } else {
          throw error;
        }
      }
      await appendAuroraLog(
        `Итог: записано свободных ${counts.free}, купленных ${counts.purchased}\n`,
      );
      await flushAuroraLog();
      try {
        await dropCommittedInbox();
      } catch {
        await appendAuroraLog("Файлы остались. Повторите загрузку.\n");
        await flushAuroraLog();
      }
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.AURORA_SYNC,
          entityType: "aurora",
          entityId: "aurora",
          ip: actor.ip,
          meta: { free: counts.free, purchased: counts.purchased },
        })
        .catch(() => undefined);
    } catch (error) {
      await dropStage(runId).catch(() => undefined);
      const message =
        (error instanceof Error ? sanitizeLogLine(error.message) : "") ||
        "Не удалось записать номера.";
      await appendAuroraLog(`Итог: каталог не изменён\nОшибка: ${message}\n`).catch(
        () => undefined,
      );
      await flushAuroraLog().catch(() => undefined);
      await finishError(runId, message).catch(() => undefined);
      await auditService
        .append({
          actorUserId: actor.userId,
          action: AUDIT_ACTIONS.AURORA_SYNC,
          entityType: "aurora",
          entityId: "aurora",
          ip: actor.ip,
          meta: { failed: true },
        })
        .catch(() => undefined);
    } finally {
      endAurora(holder);
    }
  })();
  return { ok: true };
}

export async function cancelAuroraSync(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const rows = await prisma.$queryRaw<{ run_id: string }[]>`
      UPDATE aurora_sync_state
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
