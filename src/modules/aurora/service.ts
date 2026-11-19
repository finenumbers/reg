/**
 * Aurora link save, the link check, and the walk share one holder.
 * Saving a link does not download and does not take the database lease.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { cardLabels } from "@/modules/numbering-sync/card-numbers";
import { getDisplayTimezone } from "@/modules/settings/service";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { chainStartBlock } from "@/modules/numbering-chain/gate";
import { downloadAuroraCsv, auroraInterruptedMessage } from "@/modules/aurora/fetch";
import {
  addAuroraLink,
  countAuroraLinks,
  listAuroraLinks,
  moveAuroraLink,
  removeAuroraLink,
  unreadableAuroraLink,
  type AuroraLinkRow,
} from "@/modules/aurora/files";
import {
  endAurora,
  isAuroraActive,
  isAuroraStopping,
  tryBeginAurora,
} from "@/modules/aurora/lease";
import {
  appendAuroraLog,
  auroraLogExists,
  beginAuroraLog,
  flushAuroraLog,
  sanitizeLogLine,
} from "@/modules/aurora/log";
import {
  auroraFormatLabel,
  combineAuroraFiles,
  decodeAuroraCsv,
  shouldPublishAurora,
  type AuroraFileText,
  type AuroraFormat,
  type ParsedAurora,
} from "@/modules/aurora/parse";
import {
  auroraEndpointLabel,
  auroraOperatorError,
  canonicalizeAuroraUrl,
} from "@/modules/aurora/url";
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
const NO_LINKS = "Ссылки ещё не указаны.";
const EMPTY = "В ссылках нет номеров. Каталог не изменён.";
const LOG_OPEN_FAILED = "Не удалось открыть журнал стадии.";
const START_FAILED = "Не удалось начать загрузку.";
const CANCELLED = "Загрузка отменена. Каталог не изменён.";

type AuroraLoadFile = {
  id: string;
  url: string;
  format: AuroraFormat;
  unreadable: boolean;
};

export type AuroraLoadView = {
  files: AuroraLoadFile[];
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
  freeShown: number | null;
  purchasedShown: number | null;
  freeLoadedAtLabel: string;
  hasLog: boolean;
  hasFiles: boolean;
};

type Actor = { userId: string | null; ip?: string | null };
type LeaseBeat = "ok" | "cancel" | "lost";

type StateRow = {
  phase: string;
  page_done: number;
  page_total: number;
  last_error: string | null;
  last_free_written: number | null;
  last_purchased_written: number | null;
  free_loaded_at: Date | null;
  staged_free: number;
  staged_purchased: number;
  busy: boolean;
};

function heldError(reason: "busy" | "stopping"): string {
  return reason === "stopping" ? STOPPING : BUSY;
}

export async function getAuroraLoadView(): Promise<AuroraLoadView> {
  const links = await listAuroraLinks();
  return {
    files: links.map((link) => ({
      id: link.id,
      url: link.unreadable ? "" : link.url,
      format: link.format,
      unreadable: link.unreadable,
    })),
    busy: isAuroraActive(),
  };
}

export async function getAuroraSyncView(): Promise<AuroraSyncView> {
  const [rows, hasLog, linkCount, timeZone] = await Promise.all([
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, page_done, page_total, last_error,
        last_free_written, last_purchased_written,
        free_loaded_at,
        (
          SELECT count(*)::int FROM aurora_sync_stage AS stage
          WHERE stage.run_id = aurora_sync_state.run_id
            AND stage.catalog = 'free'
        ) AS staged_free,
        (
          SELECT count(*)::int FROM aurora_sync_stage AS stage
          WHERE stage.run_id = aurora_sync_state.run_id
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
      FROM aurora_sync_state
      WHERE id = 1
    `,
    auroraLogExists(),
    countAuroraLinks(),
    getDisplayTimezone(),
  ]);
  const state = rows[0];
  const busy = Boolean(state?.busy) || isAuroraActive();
  const phase = busy ? (state?.phase ?? "") : "";
  const lastFree = state?.last_free_written ?? null;
  const lastPurchased = state?.last_purchased_written ?? null;
  return {
    busy,
    phase,
    pageDone: busy ? (state?.page_done ?? 0) : 0,
    pageTotal: busy ? (state?.page_total ?? 0) : 0,
    lastError: state?.last_error ?? null,
    lastFree,
    lastPurchased,
    ...cardLabels({
      kind: "aurora",
      busy,
      step: null,
      list: "",
      phase,
      lastFree,
      lastPurchased,
      stagedFree: state?.staged_free,
      stagedPurchased: state?.staged_purchased,
      purchasedLoadedAt: null,
      freeLoadedAt: state?.free_loaded_at,
      timeZone,
    }),
    hasLog,
    hasFiles: linkCount > 0,
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

function watchStop(parent: AbortSignal): { signal: AbortSignal; close: () => void } {
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (isAuroraStopping()) controller.abort();
  }, 250);
  if (parent.aborted || isAuroraStopping()) controller.abort();
  parent.addEventListener("abort", () => controller.abort(), { once: true });
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    close: () => clearInterval(timer),
  };
}

async function downloadAuroraSet(
  links: readonly AuroraLinkRow[],
  parent: AbortSignal,
  beat: (done: number, total: number) => Promise<void>,
  log: ((index: number, link: AuroraLinkRow) => Promise<void>) | null,
): Promise<ParsedAurora> {
  if (links.some((link) => link.unreadable || !link.url)) {
    return { ok: false, error: unreadableAuroraLink() };
  }
  const watched = watchStop(parent);
  try {
    const texts: AuroraFileText[] = [];
    for (let index = 0; index < links.length; index += 1) {
      const link = links[index];
      if (!link) return { ok: false, error: unreadableAuroraLink() };
      await beat(index, links.length);
      if (log) await log(index, link);
      const downloaded = await downloadAuroraCsv(
        { href: link.url, host: link.host },
        watched.signal,
      );
      if (!downloaded.ok) {
        if (downloaded.interrupted || watched.signal.aborted) {
          return { ok: false, error: auroraInterruptedMessage() };
        }
        return {
          ok: false,
          error: auroraOperatorError(
            index,
            auroraEndpointLabel(link.host, link.port),
            downloaded.error,
          ),
        };
      }
      const decoded = decodeAuroraCsv(`Ссылка ${index + 1}`, downloaded.bytes);
      if (!decoded.ok) {
        return {
          ok: false,
          error: auroraOperatorError(
            index,
            auroraEndpointLabel(link.host, link.port),
            decoded.error,
          ),
        };
      }
      texts.push({
        name: `Ссылка ${index + 1}`,
        format: link.format,
        text: decoded.text,
      });
    }
    await beat(links.length, links.length);
    const parsed = combineAuroraFiles(texts);
    if (parsed.ok) return parsed;
    const match = /Ссылка (\d+)/.exec(parsed.error);
    const index = match ? Number(match[1]) - 1 : 0;
    return {
      ok: false,
      error: auroraOperatorError(
        index,
        auroraEndpointLabel(links[index]?.host ?? "", links[index]?.port ?? ""),
        parsed.error,
      ),
    };
  } finally {
    watched.close();
  }
}

export async function saveAuroraLink(
  input: { url: string; format: string },
  actor: Actor,
): Promise<{ ok: true; settings: AuroraLoadView } | { ok: false; error: string }> {
  const saved = await withHolder(() => addAuroraLink(input));
  if (!saved.ok) return saved;
  const parsed = canonicalizeAuroraUrl(input.url);
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.AURORA_SAVE,
    entityType: "aurora_files",
    entityId: "aurora",
    ip: actor.ip,
    meta: { host: parsed.ok ? parsed.host : "", format: input.format },
  });
  return { ok: true, settings: await getAuroraLoadView() };
}

export async function deleteAuroraLink(
  id: string,
  actor: Actor,
): Promise<{ ok: true; settings: AuroraLoadView } | { ok: false; error: string }> {
  const removed = await withHolder(() => removeAuroraLink(id));
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

export async function reorderAuroraLink(
  id: string,
  direction: "up" | "down",
): Promise<{ ok: true; settings: AuroraLoadView } | { ok: false; error: string }> {
  const moved = await withHolder(() => moveAuroraLink(id, direction));
  if (!moved.ok) return moved;
  return { ok: true, settings: await getAuroraLoadView() };
}

export async function checkAuroraLinks(
  actor: Actor,
  signal: AbortSignal,
): Promise<
  { ok: true; read: number; kept: number; dropped: number } | { ok: false; error: string }
> {
  const checked = await withHolder(async () => {
    const links = await listAuroraLinks();
    if (links.length === 0) return { ok: false as const, error: NO_LINKS };
    const parsed = await downloadAuroraSet(links, signal, async () => undefined, null);
    if (!parsed.ok) {
      if (parsed.error === auroraInterruptedMessage()) {
        return { ok: false as const, error: "Проверка прервана." };
      }
      return parsed;
    }
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
  options?: { fromChain?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  armNumberingSyncStop();
  if (isDatabaseVacuumActive()) return { ok: false, error: CDR_VACUUM_BUSY_MESSAGE };
  const blocked = chainStartBlock(options?.fromChain);
  if (blocked) return { ok: false, error: blocked };
  const begun = tryBeginAurora();
  if (!begun.ok) return { ok: false, error: heldError(begun.reason) };
  const holder = begun.token;
  let snapshot: AuroraLinkRow[];
  try {
    const links = await listAuroraLinks();
    if (links.length === 0 || links.some((link) => link.unreadable)) {
      endAurora(holder);
      return {
        ok: false,
        error: links.length === 0 ? NO_LINKS : unreadableAuroraLink(),
      };
    }
    snapshot = links.map((link) => ({ ...link }));
  } catch {
    endAurora(holder);
    return { ok: false, error: START_FAILED };
  }
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
  let seenTotal = snapshot.length;
  void (async () => {
    try {
      const guard = async () => {
        if (isAuroraStopping()) throw new Error(CANCELLED);
        const state = await beat(runId, seenDone, seenTotal);
        if (state === "cancel") throw new Error(CANCELLED);
        if (state === "lost") throw new SyncLost();
      };
      const parsed = await downloadAuroraSet(
        snapshot,
        new AbortController().signal,
        async (done, total) => {
          seenDone = done;
          seenTotal = total;
          await guard();
        },
        async (index, link) => {
          await appendAuroraLog(
            [
              `Ссылка: ${index + 1}`,
              `Формат: ${auroraFormatLabel(link.format)}`,
              `Узел: ${auroraEndpointLabel(link.host, link.port)}`,
              "",
            ].join("\n"),
          );
        },
      );
      if (!parsed.ok) {
        if (parsed.error === auroraInterruptedMessage() || isAuroraStopping()) {
          throw new Error(CANCELLED);
        }
        throw new Error(parsed.error);
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

export async function cancelAuroraSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
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
