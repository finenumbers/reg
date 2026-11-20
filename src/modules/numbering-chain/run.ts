import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { whenDecorateIdle } from "@/modules/numbering-catalog/decorate";
import { deliverNumberingSummary } from "@/modules/mail/summary-send";
import { applyChainStep, emptyChainMarks } from "@/modules/mail/summary-marks";
import { cancelAuroraSync, startAuroraSync } from "@/modules/aurora/service";
import { isAuroraActive } from "@/modules/aurora/lease";
import {
  cancelExolveSync,
  startExolveFree,
  startExolvePurchased,
} from "@/modules/exolve/service";
import { isExolveActive } from "@/modules/exolve/lease";
import {
  cancelFinenumbersSync,
  startFinenumbersSync,
} from "@/modules/finenumbers/service";
import { isFinenumbersActive } from "@/modules/finenumbers/lease";
import { cancelMcnSync, startMcnFree, startMcnPurchased } from "@/modules/mcn/service";
import { isMcnActive } from "@/modules/mcn/lease";
import { chainSlot } from "@/modules/numbering-chain/gate";
import {
  CHAIN_SOURCES,
  type ChainSide,
  type ChainSourceId,
} from "@/modules/numbering-chain/order";
import {
  CHAIN_STOPPING,
  classifyFinish,
  classifyStart,
} from "@/modules/numbering-chain/outcome";
import {
  isNumberingSyncActive,
  isNumberingSyncStopping,
} from "@/modules/numbering-sync/lease";
import {
  cancelSipoutSync,
  startSipoutFree,
  startSipoutPurchased,
} from "@/modules/numbering-sync/service";
import {
  cancelRunexisSync,
  startRunexisFree,
  startRunexisPurchased,
} from "@/modules/runexis/service";
import { isRunexisActive } from "@/modules/runexis/lease";
import { cancelUisSync, startUisFree, startUisPurchased } from "@/modules/uis/service";
import { isUisActive } from "@/modules/uis/lease";
import {
  cancelVoximplantSync,
  startVoximplantFree,
  startVoximplantPurchased,
} from "@/modules/voximplant/service";
import { isVoximplantActive } from "@/modules/voximplant/lease";

const RETRY_MS = 2_000;
const ALREADY = "Цепочка уже идёт.";

type Actor = { userId: string | null; ip?: string | null };
type StartResult = { ok: true } | { ok: false; error: string };

type StepRun = {
  id: ChainSourceId;
  side: ChainSide;
  active: () => boolean;
  start: (actor: Actor) => Promise<StartResult>;
  cancel: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

const STEPS: StepRun[] = [
  {
    id: "sipout",
    side: "purchased",
    active: isNumberingSyncActive,
    start: (actor) => startSipoutPurchased(actor, { fromChain: true }),
    cancel: () => cancelSipoutSync(),
  },
  {
    id: "sipout",
    side: "free",
    active: isNumberingSyncActive,
    start: (actor) => startSipoutFree(actor, { fromChain: true }),
    cancel: () => cancelSipoutSync(),
  },
  {
    id: "runexis",
    side: "purchased",
    active: isRunexisActive,
    start: (actor) => startRunexisPurchased(actor, { fromChain: true }),
    cancel: () => cancelRunexisSync(),
  },
  {
    id: "runexis",
    side: "free",
    active: isRunexisActive,
    start: (actor) => startRunexisFree(actor, { fromChain: true }),
    cancel: () => cancelRunexisSync(),
  },
  {
    id: "uis",
    side: "purchased",
    active: isUisActive,
    start: (actor) => startUisPurchased(actor, { fromChain: true }),
    cancel: () => cancelUisSync(),
  },
  {
    id: "uis",
    side: "free",
    active: isUisActive,
    start: (actor) => startUisFree(actor, { fromChain: true }),
    cancel: () => cancelUisSync(),
  },
  {
    id: "aurora",
    side: "free",
    active: isAuroraActive,
    start: (actor) => startAuroraSync(actor, { fromChain: true }),
    cancel: () => cancelAuroraSync(),
  },
  {
    id: "exolve",
    side: "purchased",
    active: isExolveActive,
    start: (actor) => startExolvePurchased(actor, { fromChain: true }),
    cancel: () => cancelExolveSync(),
  },
  {
    id: "exolve",
    side: "free",
    active: isExolveActive,
    start: (actor) => startExolveFree(actor, { fromChain: true }),
    cancel: () => cancelExolveSync(),
  },
  {
    id: "voximplant",
    side: "purchased",
    active: isVoximplantActive,
    start: (actor) => startVoximplantPurchased(actor, { fromChain: true }),
    cancel: () => cancelVoximplantSync(),
  },
  {
    id: "voximplant",
    side: "free",
    active: isVoximplantActive,
    start: (actor) => startVoximplantFree(actor, { fromChain: true }),
    cancel: () => cancelVoximplantSync(),
  },
  {
    id: "mcn",
    side: "purchased",
    active: isMcnActive,
    start: (actor) => startMcnPurchased(actor, { fromChain: true }),
    cancel: () => cancelMcnSync(),
  },
  {
    id: "mcn",
    side: "free",
    active: isMcnActive,
    start: (actor) => startMcnFree(actor, { fromChain: true }),
    cancel: () => cancelMcnSync(),
  },
  {
    id: "finenumbers",
    side: "both",
    active: isFinenumbersActive,
    start: (actor) => startFinenumbersSync(actor, { fromChain: true }),
    cancel: () => cancelFinenumbersSync(),
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitDecorateOrStop(): Promise<boolean> {
  const idle = whenDecorateIdle();
  for (;;) {
    if (shouldStop()) return false;
    const step = await Promise.race([
      idle.then(() => "idle" as const),
      sleep(1_000).then(() => "tick" as const),
    ]);
    if (step === "idle") return !shouldStop();
  }
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
    case "finenumbers":
      return Prisma.sql`SELECT last_finished_at AS at, last_error AS error FROM finenumbers_sync_state WHERE id = 1`;
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
    if (STEPS.every((step) => !step.active())) return;
    await sleep(1_000);
  }
}

async function waitWalk(step: StepRun): Promise<boolean> {
  let landed = false;
  while (step.active()) {
    if (shouldStop() && !landed) {
      const cancelled = await step.cancel();
      if (cancelled.ok) landed = true;
    }
    await sleep(1_000);
  }
  return landed;
}

async function runChain(actor: Actor): Promise<void> {
  const slot = chainSlot();
  const marks = emptyChainMarks();
  const startedAt = new Date();
  let send = false;
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
    let index = 0;
    while (index < STEPS.length) {
      if (shouldStop()) break;
      const step = STEPS[index];
      if (!step) break;
      slot.index = index;
      slot.mode = "masks";
      await waitQuiet();
      if (shouldStop()) break;
      slot.mode = "read";
      const before = await readStamp(step.id);
      let started = false;
      let skippedStart = false;
      for (;;) {
        if (isNumberingSyncStopping()) {
          slot.stopTail = true;
          break;
        }
        if (slot.stopTail) break;
        const result = await step.start(actor);
        if (result.ok) {
          started = true;
          break;
        }
        const kind = classifyStart(result.error);
        if (kind === "retry") {
          await sleep(RETRY_MS);
          continue;
        }
        if (kind === "skip") skippedStart = true;
        if (kind === "stop") slot.stopTail = true;
        break;
      }
      if (slot.stopTail) break;
      if (!started) {
        applyChainStep(marks, {
          id: step.id,
          side: step.side,
          started: false,
          skipped: skippedStart,
          ok: false,
          at: null,
        });
        index += step.side === "purchased" ? 2 : 1;
        continue;
      }
      const cancelLanded = await waitWalk(step);
      const after = await readStamp(step.id);
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
      applyChainStep(marks, {
        id: step.id,
        side: step.side,
        started: true,
        skipped: false,
        ok: finish === "ok",
        at: after.at,
      });
      const skipFree = step.side === "purchased" && finish !== "ok";
      index += 1;
      if (skipFree && STEPS[index]?.id === step.id && STEPS[index]?.side === "free")
        index += 1;
    }
    if (!slot.stopTail && !isNumberingSyncStopping()) {
      send = await waitDecorateOrStop();
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
  if (send) {
    await deliverNumberingSummary({
      marks,
      startedAt,
      scheduled: actor.userId == null,
    }).catch(() => undefined);
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
