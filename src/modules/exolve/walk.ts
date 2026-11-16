/**
 * Purchased numbers first, then every free cell from the directory.
 * A gap in the unfiltered purchased list is re-read by type, then category, then region.
 * A child is staged only after that child is complete. Catalogs stay until publish.
 */

import {
  DUPLICATE_NUMBER,
  KDU_WITHOUT_RUSSIA,
  UNREADABLE,
  isKduType,
  leafRegionIds,
  planFreeCells,
  type Directory,
  type ExolveFreeRow,
} from "@/modules/exolve/parse";
import {
  FREE_LIMIT,
  FREE_OFFSET_MAX,
  RUSSIA_REGION_ID,
  nextFreeOffset,
  type FreeCell,
  type PurchasedFilter,
} from "@/modules/exolve/url";

export const PURCHASED_CHANGED = "Список изменился во время чтения. Каталог не изменён.";
export const PURCHASED_GAP = "Ответ площадки обрезан. Каталог не изменён.";
export const SUM_MISMATCH = "Сумма разделов не сошлась. Каталог не изменён.";
export const FREE_OFFSET_TOO_FAR =
  "Смещение свободных номеров слишком велико. Каталог не изменён.";
export const CANCELLED = "Загрузка отменена. Каталог не изменён.";
export const LOST = "Загрузка прервана. Каталог не изменён.";

export type { Directory, ExolveFreeRow, FreeCell, PurchasedFilter };

export type PurchasedRead =
  | { ok: true; total: number; rows: string[] }
  | { ok: false; error: string };

export type TotalRead = { ok: true; total: number } | { ok: false; error: string };

export type DirectoryRead =
  | { ok: true; directory: Directory }
  | { ok: false; error: string };

export type FreeRead =
  | { ok: true; rows: ExolveFreeRow[] }
  | { ok: false; error: string };

export type ExolveProgress = {
  list?: "" | "purchased" | "free";
  pageDone?: number;
  pageTotal?: number;
};

export type WalkBeat = (patch: ExolveProgress) => Promise<"run" | "cancel" | "lost">;

export type ExolveWalkDeps = {
  beat: WalkBeat;
  purchased: (filter: PurchasedFilter, offset: number) => Promise<PurchasedRead>;
  recount: () => Promise<TotalRead>;
  directory: () => Promise<DirectoryRead>;
  free: (cell: FreeCell, offset: number) => Promise<FreeRead>;
  stagePurchased: (dids: readonly string[]) => Promise<void>;
  dropPurchased: () => Promise<void>;
  stageFree: (rows: readonly ExolveFreeRow[]) => Promise<{ inserted: number; skipped: number }>;
  log?: (line: string) => Promise<void> | void;
  /** Tests only. The service leaves this unset, so the ceiling stays 1000000. */
  freeOffsetMax?: number;
};

export type ExolveWalkResult =
  | { ok: true; free: number; purchased: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

type PageStream =
  | { status: "complete"; total: number; rows: string[] }
  | { status: "gap"; total: number }
  | { status: "fail"; error: string; reason: "lost" | "cancelled" | "error" };

function stopped(kind: "cancel" | "lost"): ExolveWalkResult {
  return kind === "cancel"
    ? { ok: false, reason: "cancelled", error: CANCELLED }
    : { ok: false, reason: "lost", error: LOST };
}

function failed(error: string): ExolveWalkResult {
  return { ok: false, reason: "error", error };
}

async function readPurchasedList(
  deps: ExolveWalkDeps,
  filter: PurchasedFilter,
  mode: "stage" | "buffer",
): Promise<PageStream> {
  let offset = 0;
  let expected: number | null = null;
  let accepted = 0;
  const buffered: string[] = [];
  const seen = new Set<string>();
  for (;;) {
    const gate = await deps.beat(
      expected == null
        ? { list: "purchased" }
        : { list: "purchased", pageDone: accepted, pageTotal: expected },
    );
    if (gate !== "run") {
      return {
        status: "fail",
        reason: gate === "cancel" ? "cancelled" : "lost",
        error: gate === "cancel" ? CANCELLED : LOST,
      };
    }
    const page = await deps.purchased(filter, offset);
    if (!page.ok) return { status: "fail", reason: "error", error: page.error };
    if (expected == null) expected = page.total;
    else if (page.total !== expected) {
      return { status: "fail", reason: "error", error: PURCHASED_CHANGED };
    }
    if (page.rows.length === 0) {
      if (accepted === expected) {
        return { status: "complete", total: expected, rows: mode === "buffer" ? buffered : [] };
      }
      return { status: "gap", total: expected };
    }
    if (accepted + page.rows.length > expected) {
      return { status: "fail", reason: "error", error: PURCHASED_CHANGED };
    }
    if (mode === "buffer") {
      for (const did of page.rows) {
        if (seen.has(did)) return { status: "fail", reason: "error", error: DUPLICATE_NUMBER };
        seen.add(did);
        buffered.push(did);
      }
    } else {
      try {
        await deps.stagePurchased(page.rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : DUPLICATE_NUMBER;
        return { status: "fail", reason: "error", error: message };
      }
    }
    accepted += page.rows.length;
    const moved = await deps.beat({
      list: "purchased",
      pageDone: accepted,
      pageTotal: expected,
    });
    if (moved !== "run") {
      return {
        status: "fail",
        reason: moved === "cancel" ? "cancelled" : "lost",
        error: moved === "cancel" ? CANCELLED : LOST,
      };
    }
    if (accepted === expected) {
      return { status: "complete", total: expected, rows: mode === "buffer" ? buffered : [] };
    }
    offset += page.rows.length;
  }
}

async function stageBuffer(
  deps: ExolveWalkDeps,
  rows: readonly string[],
): Promise<Extract<PageStream, { status: "fail" }> | null> {
  if (rows.length === 0) return null;
  try {
    await deps.stagePurchased(rows);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : DUPLICATE_NUMBER;
    return { status: "fail", reason: "error", error: message };
  }
}

async function readRegions(
  deps: ExolveWalkDeps,
  typeName: string,
  categoryId: number,
  regionIds: readonly number[],
): Promise<{ ok: true; rows: string[]; sum: number } | { ok: false; error: string; reason: "lost" | "cancelled" | "error" }> {
  const rows: string[] = [];
  let sum = 0;
  for (const regionId of regionIds) {
    const child = await readPurchasedList(
      deps,
      { kind: "region", typeName, categoryId, regionId },
      "buffer",
    );
    if (child.status === "fail") return { ok: false, error: child.error, reason: child.reason };
    if (child.status === "gap") return { ok: false, error: PURCHASED_GAP, reason: "error" };
    if (child.rows.length !== child.total) {
      return { ok: false, error: SUM_MISMATCH, reason: "error" };
    }
    rows.push(...child.rows);
    sum += child.total;
  }
  return { ok: true, rows, sum };
}

async function splitCategory(
  deps: ExolveWalkDeps,
  directory: Directory,
  typeName: string,
  typeId: number,
  categoryId: number,
  parentTotal: number,
): Promise<{ ok: true; rows: string[] } | { ok: false; error: string; reason: "lost" | "cancelled" | "error" }> {
  if (isKduType({ typeId, typeName })) {
    if (!directory.regions.some((region) => region.regionId === RUSSIA_REGION_ID)) {
      return { ok: false, error: KDU_WITHOUT_RUSSIA, reason: "error" };
    }
    await deps.log?.(`purchased kdu category=${categoryId} region=${RUSSIA_REGION_ID}`);
    const child = await readPurchasedList(
      deps,
      {
        kind: "region",
        typeName,
        categoryId,
        regionId: RUSSIA_REGION_ID,
      },
      "buffer",
    );
    if (child.status === "fail") return { ok: false, error: child.error, reason: child.reason };
    if (child.status !== "complete" || child.total !== parentTotal) {
      return { ok: false, error: child.status === "gap" ? PURCHASED_GAP : SUM_MISMATCH, reason: "error" };
    }
    return { ok: true, rows: child.rows };
  }

  await deps.log?.(`purchased regions type=${typeName} category=${categoryId}`);
  const all = await readRegions(
    deps,
    typeName,
    categoryId,
    directory.regions.map((region) => region.regionId),
  );
  if (!all.ok) return all;
  if (all.sum === parentTotal) return { ok: true, rows: all.rows };
  if (all.sum < parentTotal) return { ok: false, error: SUM_MISMATCH, reason: "error" };

  const leaves = leafRegionIds(directory.regions);
  await deps.log?.(`purchased leaves type=${typeName} category=${categoryId}`);
  const leaf = await readRegions(deps, typeName, categoryId, leaves);
  if (!leaf.ok) return leaf;
  if (leaf.sum !== parentTotal) return { ok: false, error: SUM_MISMATCH, reason: "error" };
  return { ok: true, rows: leaf.rows };
}

async function splitType(
  deps: ExolveWalkDeps,
  directory: Directory,
  type: Directory["types"][number],
  parentTotal: number,
): Promise<{ ok: true; rows: string[] } | { ok: false; error: string; reason: "lost" | "cancelled" | "error" }> {
  const rows: string[] = [];
  let sum = 0;
  for (const category of type.categories) {
    const child = await readPurchasedList(
      deps,
      { kind: "category", typeName: type.typeName, categoryId: category.categoryId },
      "buffer",
    );
    if (child.status === "fail") return { ok: false, error: child.error, reason: child.reason };
    let taken: string[];
    let total: number;
    if (child.status === "complete") {
      taken = child.rows;
      total = child.total;
    } else {
      const split = await splitCategory(
        deps,
        directory,
        type.typeName,
        type.typeId,
        category.categoryId,
        child.total,
      );
      if (!split.ok) return split;
      taken = split.rows;
      total = child.total;
    }
    if (taken.length !== total) return { ok: false, error: SUM_MISMATCH, reason: "error" };
    rows.push(...taken);
    sum += total;
    if (sum > parentTotal) return { ok: false, error: SUM_MISMATCH, reason: "error" };
  }
  if (sum !== parentTotal) return { ok: false, error: SUM_MISMATCH, reason: "error" };
  return { ok: true, rows };
}

async function readByLayers(
  deps: ExolveWalkDeps,
  directory: Directory,
  parentTotal: number,
): Promise<ExolveWalkResult | null> {
  let sum = 0;
  for (const type of directory.types) {
    await deps.log?.(`purchased type=${type.typeName}`);
    const child = await readPurchasedList(deps, { kind: "type", typeName: type.typeName }, "buffer");
    if (child.status === "fail") {
      return { ok: false, reason: child.reason, error: child.error };
    }
    let rows: string[];
    let total: number;
    if (child.status === "complete") {
      rows = child.rows;
      total = child.total;
    } else {
      const split = await splitType(deps, directory, type, child.total);
      if (!split.ok) return { ok: false, reason: split.reason, error: split.error };
      rows = split.rows;
      total = child.total;
    }
    if (rows.length !== total) return failed(SUM_MISMATCH);
    const staged = await stageBuffer(deps, rows);
    if (staged) return { ok: false, reason: staged.reason, error: staged.error };
    sum += total;
    if (sum > parentTotal) return failed(SUM_MISMATCH);
  }
  if (sum !== parentTotal) return failed(SUM_MISMATCH);
  const moved = await deps.beat({
    list: "purchased",
    pageDone: parentTotal,
    pageTotal: parentTotal,
  });
  if (moved !== "run") return stopped(moved);
  return null;
}

async function loadDirectory(
  deps: ExolveWalkDeps,
  cached: Directory | null,
): Promise<{ ok: true; directory: Directory } | ExolveWalkResult> {
  if (cached) return { ok: true, directory: cached };
  const gate = await deps.beat({ list: "purchased" });
  if (gate !== "run") return stopped(gate);
  const page = await deps.directory();
  if (!page.ok) return failed(page.error);
  return { ok: true, directory: page.directory };
}

async function readFree(
  deps: ExolveWalkDeps,
  cells: readonly FreeCell[],
): Promise<ExolveWalkResult | { count: number }> {
  const ceiling = deps.freeOffsetMax ?? FREE_OFFSET_MAX;
  let done = 0;
  let staged = 0;
  const started = await deps.beat({ list: "free", pageDone: 0, pageTotal: cells.length });
  if (started !== "run") return stopped(started);
  for (const cell of cells) {
    const seen = new Set<string>();
    let offset = 0;
    for (;;) {
      if (offset > ceiling) return failed(FREE_OFFSET_TOO_FAR);
      const gate = await deps.beat({ list: "free", pageDone: done, pageTotal: cells.length });
      if (gate !== "run") return stopped(gate);
      const page = await deps.free(cell, offset);
      if (!page.ok) return failed(page.error);
      if (page.rows.length > FREE_LIMIT) return failed(UNREADABLE);
      for (const row of page.rows) {
        if (seen.has(row.e164)) return failed(DUPLICATE_NUMBER);
        seen.add(row.e164);
      }
      if (page.rows.length > 0) {
        const wrote = await deps.stageFree(page.rows);
        staged += wrote.inserted;
      }
      if (page.rows.length < FREE_LIMIT) break;
      const next = nextFreeOffset(offset, page.rows.length);
      if (next == null || next > ceiling) return failed(FREE_OFFSET_TOO_FAR);
      offset = next;
    }
    done += 1;
    const moved = await deps.beat({ list: "free", pageDone: done, pageTotal: cells.length });
    if (moved !== "run") return stopped(moved);
  }
  return { count: staged };
}

export async function runExolveWalk(deps: ExolveWalkDeps): Promise<ExolveWalkResult> {
  const purchased = await readPurchasedList(deps, { kind: "all" }, "stage");
  if (purchased.status === "fail") {
    return { ok: false, reason: purchased.reason, error: purchased.error };
  }

  let directory: Directory | null = null;
  if (purchased.status === "gap") {
    await deps.dropPurchased();
    await deps.log?.("purchased split");
    const loaded = await loadDirectory(deps, null);
    if (!("directory" in loaded)) return loaded;
    directory = loaded.directory;
    const layers = await readByLayers(deps, directory, purchased.total);
    if (layers) return layers;
  }

  const gate = await deps.beat({
    list: "purchased",
    pageDone: purchased.total,
    pageTotal: purchased.total,
  });
  if (gate !== "run") return stopped(gate);
  const recounted = await deps.recount();
  if (!recounted.ok) return failed(recounted.error);
  if (recounted.total !== purchased.total) return failed(PURCHASED_CHANGED);

  const loaded = await loadDirectory(deps, directory);
  if (!("directory" in loaded)) return loaded;
  const cells = planFreeCells(loaded.directory);
  if (!cells.ok) return failed(cells.error);
  const free = await readFree(deps, cells.cells);
  if ("ok" in free) return free;
  return { ok: true, free: free.count, purchased: purchased.total };
}
