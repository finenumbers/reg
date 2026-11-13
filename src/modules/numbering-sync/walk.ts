/**
 * Read every handbook page, then publish once.
 * A failed page drops the draft and leaves the catalog.
 */

import { SyncLost } from "@/modules/numbering-sync/errors";
import type { SyncCatalog } from "@/modules/numbering-sync/sql";
import { parseCityIds, parseDidList } from "@/modules/sipout/parse";
import type { SipoutPage } from "@/modules/sipout/client";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type WalkDeps = {
  getCities: () => Promise<SipoutPage>;
  freeList: (cityId: string) => Promise<SipoutPage>;
  connectedList: () => Promise<SipoutPage>;
  stillMine: () => Promise<LeaseBeat>;
  stage: (dids: string[]) => Promise<void>;
  publish: () => Promise<number>;
  dropStage: () => Promise<void>;
  progress: (done: number, total: number) => Promise<void>;
};

export type WalkResult =
  | { ok: true; count: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const NO_CITIES = "Площадка не вернула города. Каталог не изменён.";
const WRITE_FAILED = "Не удалось записать номера.";

async function beat(deps: WalkDeps): Promise<WalkResult | null> {
  const state = await deps.stillMine();
  if (state === "ok") return null;
  if (state === "cancel") return { ok: false, reason: "cancelled", error: CANCELLED };
  return { ok: false, reason: "lost", error: "" };
}

async function stop(deps: WalkDeps, result: WalkResult): Promise<WalkResult> {
  await deps.dropStage();
  return result;
}

async function publishOwned(deps: WalkDeps): Promise<WalkResult> {
  const before = await beat(deps);
  if (before) return stop(deps, before);
  try {
    const count = await deps.publish();
    return { ok: true, count };
  } catch (error) {
    await deps.dropStage();
    if (error instanceof SyncLost) return { ok: false, reason: "lost", error: "" };
    return { ok: false, reason: "error", error: WRITE_FAILED };
  }
}

export async function runCatalogWalk(
  catalog: SyncCatalog,
  deps: WalkDeps,
): Promise<WalkResult> {
  if (catalog === "purchased") return loadPurchased(deps);
  return loadFree(deps);
}

async function loadPurchased(deps: WalkDeps): Promise<WalkResult> {
  const first = await beat(deps);
  if (first) return stop(deps, first);
  await deps.progress(0, 1);
  const page = await deps.connectedList();
  if (!page.ok) return stop(deps, { ok: false, reason: "error", error: page.error });
  const dids = parseDidList(page.data);
  if (!dids.ok) return stop(deps, { ok: false, reason: "error", error: dids.error });
  if (dids.dids.length > 0) await deps.stage(dids.dids);
  await deps.progress(1, 1);
  return publishOwned(deps);
}

async function loadFree(deps: WalkDeps): Promise<WalkResult> {
  const first = await beat(deps);
  if (first) return stop(deps, first);
  const cities = await deps.getCities();
  if (!cities.ok) return stop(deps, { ok: false, reason: "error", error: cities.error });
  const ids = parseCityIds(cities.data);
  if (!ids.ok) return stop(deps, { ok: false, reason: "error", error: ids.error });
  if (ids.ids.length === 0)
    return stop(deps, { ok: false, reason: "error", error: NO_CITIES });
  await deps.progress(0, ids.ids.length);
  for (let index = 0; index < ids.ids.length; index += 1) {
    const cityId = ids.ids[index]!;
    const held = await beat(deps);
    if (held) return stop(deps, held);
    const page = await deps.freeList(cityId);
    if (!page.ok) return stop(deps, { ok: false, reason: "error", error: page.error });
    const dids = parseDidList(page.data);
    if (!dids.ok) return stop(deps, { ok: false, reason: "error", error: dids.error });
    if (dids.dids.length > 0) await deps.stage(dids.dids);
    await deps.progress(index + 1, ids.ids.length);
  }
  return publishOwned(deps);
}
