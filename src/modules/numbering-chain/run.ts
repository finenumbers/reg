import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { whenDecorateIdle } from "@/modules/numbering-catalog/decorate";
import { cancelAuroraSync, startAuroraSync } from "@/modules/aurora/service";
import { isAuroraActive } from "@/modules/aurora/lease";
import { cancelExolveSync, startExolveSync } from "@/modules/exolve/service";
import { isExolveActive } from "@/modules/exolve/lease";
import { cancelMcnSync, startMcnSync } from "@/modules/mcn/service";
import { isMcnActive } from "@/modules/mcn/lease";
import { chainSlot } from "@/modules/numbering-chain/gate";
import { CHAIN_SOURCES, type ChainSourceId } from "@/modules/numbering-chain/order";
import {
  CHAIN_STOPPING,
  classifyFinish,
  classifyStart,
} from "@/modules/numbering-chain/outcome";
import {
  isNumberingSyncActive,
  isNumberingSyncStopping,
} from "@/modules/numbering-sync/lease";
import { cancelSipoutSync, startSipoutSync } from "@/modules/numbering-sync/service";
import { cancelRunexisSync, startRunexisSync } from "@/modules/runexis/service";
import { isRunexisActive } from "@/modules/runexis/lease";
import { cancelUisSync, startUisSync } from "@/modules/uis/service";
import { isUisActive } from "@/modules/uis/lease";
import { cancelVoximplantSync, startVoximplantSync } from "@/modules/voximplant/service";
import { isVoximplantActive } from "@/modules/voximplant/lease";

const RETRY_MS = 2_000;
const ALREADY = "Цепочка уже идёт.";

type Actor = { userId: string | null; ip?: string | null };
type StartResult = { ok: true } | { ok: false; error: string };

type SourceRun = {
  id: ChainSourceId;
  active: () => boolean;
  start: (actor: Actor) => Promise<StartResult>;
  cancel: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

const RUNNERS: SourceRun[] = [
  {
    id: "sipout",
    active: isNumberingSyncActive,
    start: (actor) => startSipoutSync(actor, { fromChain: true }),
    cancel: () => cancelSipoutSync(),
  },
  {
    id: "runexis",
    active: isRunexisActive,
    start: (actor) => startRunexisSync(actor, { fromChain: true }),
    cancel: () => cancelRunexisSync(),
  },
  {
    id: "uis",
    active: isUisActive,
    start: (actor) => startUisSync(actor, { fromChain: true }),
    cancel: () => cancelUisSync(),
  },
  {
    id: "aurora",
    active: isAuroraActive,
    start: (actor) => startAuroraSync(actor, { fromChain: true }),
    cancel: () => cancelAuroraSync(),
  },
  {
    id: "exolve",
    active: isExolveActive,
    start: (actor) => startExolveSync(actor, { fromChain: true }),
    cancel: () => cancelExolveSync(),
  },
  {
    id: "voximplant",
    active: isVoximplantActive,
    start: (actor) => startVoximplantSync(actor, { fromChain: true }),
    cancel: () => cancelVoximplantSync(),
  },
  {
    id: "mcn",
    active: isMcnActive,
    start: (actor) => startMcnSync(actor, { fromChain: true }),
    cancel: () => cancelMcnSync(),
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stampMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function stampQuery(id: ChainSourceId): Prisma.Sql {
  switch (id) {
    case "sipout":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM numbering_sync_state WHERE id = 1`;
    case "runexis":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM runexis_sync_state WHERE id = 1`;
    case "uis":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM uis_sync_state WHERE id = 1`;
    case "aurora":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM aurora_sync_state WHERE id = 1`;
    case "exolve":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM exolve_sync_state WHERE id = 1`;
    case "voximplant":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM voximplant_sync_state WHERE id = 1`;
    case "mcn":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM mcn_sync_state WHERE id = 1`;
  }
}

async function readStamp(
  id: ChainSourceId,
): Promise<{ at: number | null; error: string | null }> {
  const rows = await prisma.$queryRaw<{ at: unknown; error: string | null }[]>(
    stampQuery(id),
  );
  const row = rows[0];
  return { at: stampMs(row?.at), error: row?.error ?? null };
}

function shouldStop(): boolean {
  return chainSlot().stopTail || isNumberingSyncStopping();
}

async function waitQuiet(): Promise<void> {
  for (;;) {
    if (shouldStop()) return;
    await whenDecorateIdle();
    if (shouldStop()) return;
    if (RUNNERS.every((source) => !source.active())) return;
    await sleep(1_000);
  }
}

async function waitWalk(source: SourceRun): Promise<boolean> {
  let landed = false;
  while (source.active()) {
    if (shouldStop() && !landed) {
      const cancelled = await source.cancel();
      if (cancelled.ok) landed = true;
    }
    await sleep(1_000);
  }
  return landed;
}

async function runChain(actor: Actor): Promise<void> {
  const slot = chainSlot();
  try {
    await auditService
      .append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.NUMBERING_CHAIN,
        entityType: "numbering_chain",
        entityId: "chain",
        ip: actor.ip,
        meta: { started: true },
      })
      .catch(() => undefined);
    for (let index = 0; index < RUNNERS.length; index += 1) {
      if (shouldStop()) break;
      const source = RUNNERS[index];
      if (!source) break;
      slot.index = index;
      slot.mode = "masks";
      await waitQuiet();
      if (shouldStop()) break;
      slot.mode = "read";
      const before = await readStamp(source.id);
      let started = false;
      for (;;) {
        if (isNumberingSyncStopping()) {
          slot.stopTail = true;
          break;
        }
        if (slot.stopTail) break;
        const result = await source.start(actor);
        if (result.ok) {
          started = true;
          break;
        }
        const kind = classifyStart(result.error);
        if (kind === "retry") {
          await sleep(RETRY_MS);
          continue;
        }
        if (kind === "stop") slot.stopTail = true;
        break;
      }
      if (slot.stopTail) break;
      if (!started) continue;
      const cancelLanded = await waitWalk(source);
      const after = await readStamp(source.id);
      const finish = classifyFinish({
        beforeFinishedAt: before.at,
        afterFinishedAt: after.at,
        lastError: after.error,
        stopping: isNumberingSyncStopping(),
      });
      if (
        slot.stopTail &&
        finish === "ok" &&
        !cancelLanded &&
        !isNumberingSyncStopping()
      ) {
        slot.stopTail = false;
      }
      if (finish === "stop" || slot.stopTail || isNumberingSyncStopping()) {
        slot.stopTail = true;
        break;
      }
    }
  } finally {
    slot.running = false;
    slot.mode = "idle";
    slot.stopTail = false;
    await auditService
      .append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.NUMBERING_CHAIN,
        entityType: "numbering_chain",
        entityId: "chain",
        ip: actor.ip,
        meta: { finished: true },
      })
      .catch(() => undefined);
  }
}

export async function startNumberingChain(
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isNumberingSyncStopping()) return { ok: false, error: CHAIN_STOPPING };
  const slot = chainSlot();
  if (slot.running) return { ok: false, error: ALREADY };
  slot.running = true;
  slot.stopTail = false;
  slot.index = 0;
  slot.mode = "wait";
  void runChain(actor);
  return { ok: true };
}

export async function cancelNumberingChain(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const slot = chainSlot();
  if (!slot.running) return { ok: false, error: "Цепочка не идёт." };
  slot.stopTail = true;
  return { ok: true };
}

export { CHAIN_SOURCES };
