/**
 * SipOut key and one catalog walk. The key captured at the start is not reread.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  dropStage,
  publishCatalog,
  stageNumbers,
} from "@/modules/numbering-sync/publish";
import type { SyncCatalog } from "@/modules/numbering-sync/sql";
import { runCatalogWalk, type LeaseBeat } from "@/modules/numbering-sync/walk";
import { sipoutGet } from "@/modules/sipout/client";
import { SIPOUT_ORIGIN } from "@/modules/sipout/url";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";

const BUSY = "Уже выполняется.";
const NO_KEY = "Ключ ещё не задан.";
const BAD_KEY = "Ключ не читается.";

export type NumberingSyncView = {
  host: typeof SIPOUT_ORIGIN;
  hasKey: boolean;
  busy: boolean;
  phase: string;
  catalog: string | null;
  citiesDone: number;
  citiesTotal: number;
  lastCatalog: string | null;
  lastError: string | null;
  lastWritten: number | null;
};

type Actor = { userId: string; ip?: string | null };

type StateRow = {
  phase: string;
  catalog: string | null;
  cities_done: number;
  cities_total: number;
  last_catalog: string | null;
  last_error: string | null;
  last_written: number | null;
  busy: boolean;
};

let active = false;

function emptyView(hasKey: boolean): NumberingSyncView {
  return {
    host: SIPOUT_ORIGIN,
    hasKey,
    busy: false,
    phase: "",
    catalog: null,
    citiesDone: 0,
    citiesTotal: 0,
    lastCatalog: null,
    lastError: null,
    lastWritten: null,
  };
}

export async function getNumberingSyncView(): Promise<NumberingSyncView> {
  const [settings, rows] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { id: 1 },
      select: { sipoutApiKeyCiphertext: true },
    }),
    prisma.$queryRaw<StateRow[]>`
      SELECT phase, catalog, cities_done, cities_total, last_catalog, last_error, last_written,
        (
          run_id IS NOT NULL
          AND heartbeat_at IS NOT NULL
          AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
          AND phase IN ('running', 'publishing')
        ) AS busy
      FROM numbering_sync_state
      WHERE id = 1
    `,
  ]);
  const state = rows[0];
  if (!state) return emptyView(Boolean(settings?.sipoutApiKeyCiphertext));
  const busy = Boolean(state.busy) || active;
  return {
    host: SIPOUT_ORIGIN,
    hasKey: Boolean(settings?.sipoutApiKeyCiphertext),
    busy,
    phase: busy ? state.phase : "",
    catalog: busy ? state.catalog : null,
    citiesDone: busy ? state.cities_done : 0,
    citiesTotal: busy ? state.cities_total : 0,
    lastCatalog: state.last_catalog,
    lastError: state.last_error,
    lastWritten: state.last_written,
  };
}

async function loadKey(): Promise<string> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { sipoutApiKeyCiphertext: true },
  });
  if (!row?.sipoutApiKeyCiphertext) throw new Error(NO_KEY);
  try {
    return getSecretEncryptionService().decrypt(
      deserializeEncryptedSecret(row.sipoutApiKeyCiphertext),
    );
  } catch {
    throw new Error(BAD_KEY);
  }
}

export async function saveSipoutKey(
  token: string | undefined,
  actor: Actor,
): Promise<NumberingSyncView> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return getNumberingSyncView();
  const ciphertext = serializeEncryptedSecret(
    getSecretEncryptionService().encrypt(trimmed),
  );
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
  return getNumberingSyncView();
}

async function claim(runId: string, catalog: string): Promise<boolean> {
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

async function finishError(
  runId: string,
  catalog: SyncCatalog,
  error: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_sync_state
    SET run_id = NULL,
        catalog = NULL,
        phase = '',
        cities_done = 0,
        cities_total = 0,
        error = NULL,
        heartbeat_at = NULL,
        last_catalog = ${catalog},
        last_error = ${error},
        last_written = NULL,
        last_finished_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND run_id = ${runId}
  `;
}

function beat(runId: string, done: number, total: number): Promise<LeaseBeat> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<{ phase: string }[]>`
      UPDATE numbering_sync_state
      SET heartbeat_at = CURRENT_TIMESTAMP,
          cities_done = ${done},
          cities_total = ${total}
      WHERE id = 1 AND run_id = ${runId} AND phase = 'running'
      RETURNING phase
    `;
    if (updated.length === 1) return "ok";
    const left = await tx.$queryRaw<{ phase: string }[]>`
      SELECT phase FROM numbering_sync_state WHERE id = 1 AND run_id = ${runId}
    `;
    if (left[0]?.phase === "cancel") return "cancel";
    return "lost";
  });
}

async function auditWalk(
  actor: Actor,
  catalog: SyncCatalog,
  result: { ok: true; count: number } | { ok: false },
) {
  await auditService.append({
    actorUserId: actor.userId,
    action:
      catalog === "free"
        ? AUDIT_ACTIONS.NUMBERING_SYNC_FREE
        : AUDIT_ACTIONS.NUMBERING_SYNC_PURCHASED,
    entityType: "numbering_sync",
    entityId: catalog,
    ip: actor.ip,
    meta: result.ok
      ? { source: "sipout", catalog, count: result.count }
      : { source: "sipout", catalog, failed: true },
  });
}

export async function testSipoutAccess(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (active) return { ok: false, error: BUSY };
  let key: string;
  try {
    key = await loadKey();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  const claimed = await claim(runId, "check");
  if (!claimed) return { ok: false, error: BUSY };
  active = true;
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
    active = false;
  }
}

export async function startSipoutSync(
  catalog: SyncCatalog,
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (active) return { ok: false, error: BUSY };
  let key: string;
  try {
    key = await loadKey();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : NO_KEY };
  }
  const runId = randomUUID();
  const claimed = await claim(runId, catalog);
  if (!claimed) return { ok: false, error: BUSY };
  active = true;
  let done = 0;
  let total = 0;
  void (async () => {
    try {
      const result = await runCatalogWalk(catalog, {
        getCities: () => sipoutGet(key, { action: "get_cities" }),
        freeList: (cityId) => sipoutGet(key, { action: "free_list", cityId }),
        connectedList: () => sipoutGet(key, { action: "connected_list" }),
        stillMine: () => beat(runId, done, total),
        stage: (dids) => stageNumbers(runId, catalog, dids),
        publish: () => publishCatalog(runId, catalog),
        dropStage: () => dropStage(runId),
        progress: async (nextDone, nextTotal) => {
          done = nextDone;
          total = nextTotal;
          await beat(runId, done, total);
        },
      });
      if (!result.ok) {
        await finishError(
          runId,
          catalog,
          result.error || "Загрузка отменена. Каталог не изменён.",
        );
      }
      if (result.ok || result.reason !== "lost") {
        await auditWalk(actor, catalog, result.ok ? result : { ok: false }).catch(
          () => undefined,
        );
      }
    } catch {
      await dropStage(runId).catch(() => undefined);
      await finishError(runId, catalog, "Не удалось записать номера.").catch(
        () => undefined,
      );
      await auditWalk(actor, catalog, { ok: false }).catch(() => undefined);
    } finally {
      active = false;
    }
  })();
  return { ok: true };
}

export async function cancelSipoutSync(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const rows = await prisma.$queryRaw<{ run_id: string }[]>`
    UPDATE numbering_sync_state
    SET phase = 'cancel', heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND phase = 'running' AND run_id IS NOT NULL
    RETURNING run_id
  `;
  if (rows.length !== 1) return { ok: false, error: "Запись уже началась." };
  return { ok: true };
}
