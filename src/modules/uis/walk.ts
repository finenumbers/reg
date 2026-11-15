/**
 * Purchased numbers, then free numbers. A failed list leaves both catalogs.
 * A list larger than one UIS page window is read as prefix slices.
 */

import type { UisPage } from "@/modules/uis/client";
import { planSlices, SUM_MISMATCH, UNSPLIT, type Counted } from "@/modules/uis/partition";
import { acceptPage } from "@/modules/uis/parse";
import type { UisRow } from "@/modules/uis/parse";
import { SyncLost } from "@/modules/uis/publish";
import {
  PAGE_LIMIT,
  describeFilter,
  pageOffsets,
  type UisFilter,
  type UisList,
} from "@/modules/uis/url";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type WalkDeps = {
  count: (list: UisList, filter: UisFilter) => Promise<UisPage>;
  page: (list: UisList, filter: UisFilter, offset: number) => Promise<UisPage>;
  stillMine: () => Promise<LeaseBeat>;
  stopping: () => boolean;
  stageFree: (rows: UisRow[]) => Promise<void>;
  stagePurchased: (dids: string[]) => Promise<void>;
  prepare: () => Promise<void>;
  publish: () => Promise<{ free: number; purchased: number }>;
  dropStage: () => Promise<void>;
  progress: (list: UisList, accepted: number, total: number) => Promise<void>;
  log: (block: string) => Promise<void>;
  flushLog: () => Promise<void>;
};

export type WalkResult =
  | { ok: true; free: number; purchased: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const SHORT = "Ответ площадки обрезан. Каталог не изменён.";
const CHANGED = "Список изменился во время чтения. Каталог не изменён.";
const LOST = "Загрузка прервана. Каталог не изменён.";

const EMPTY_META = { status: 0, attempts: 1, durationMs: 0 };

function lines(title: string, page: UisPage, extra: string[]): string {
  const meta = page.meta ?? EMPTY_META;
  return [
    title,
    `Попыток: ${meta.attempts}`,
    `HTTP: ${meta.status}`,
    `Длительность, мс: ${meta.durationMs}`,
    ...extra,
    "",
  ].join("\n");
}

async function stop(deps: WalkDeps, result: WalkResult): Promise<WalkResult> {
  await deps.dropStage().catch(() => undefined);
  if (!result.ok && result.error) {
    await deps
      .log(`Итог: каталог не изменён\nОшибка: ${result.error}\n`)
      .catch(() => undefined);
  }
  await deps.flushLog().catch(() => undefined);
  return result;
}

async function gate(deps: WalkDeps): Promise<Extract<WalkResult, { ok: false }> | null> {
  if (deps.stopping()) return { ok: false, reason: "cancelled", error: CANCELLED };
  const beat = await deps.stillMine();
  if (beat === "cancel") return { ok: false, reason: "cancelled", error: CANCELLED };
  if (beat !== "ok") return { ok: false, reason: "lost", error: LOST };
  return null;
}

async function readSlice(
  deps: WalkDeps,
  list: UisList,
  slice: Counted,
  acceptedBefore: number,
  rootTotal: number,
): Promise<{ done: WalkResult | null; accepted: number }> {
  const offsets = pageOffsets(slice.total);
  if (!offsets) {
    return {
      done: await stop(deps, { ok: false, reason: "error", error: UNSPLIT }),
      accepted: acceptedBefore,
    };
  }
  let accepted = acceptedBefore;
  let seen = 0;
  const titleBase = list === "purchased" ? "Купленные" : "Свободные";
  for (const offset of offsets) {
    const blocked = await gate(deps);
    if (blocked) return { done: await stop(deps, blocked), accepted };
    const response = await deps.page(list, slice.filter, offset);
    const title = `${titleBase}, ${describeFilter(slice.filter)}, смещение ${offset}`;
    if (!response.ok || !response.rows) {
      await deps.log(lines(title, response, [])).catch(() => undefined);
      return {
        done: await stop(deps, {
          ok: false,
          reason: "error",
          error: response.ok ? SHORT : response.error,
        }),
        accepted,
      };
    }
    if (response.total !== slice.total) {
      return {
        done: await stop(deps, { ok: false, reason: "error", error: CHANGED }),
        accepted,
      };
    }
    const step = acceptPage({
      total: slice.total,
      got: response.rows.length,
      acceptedBefore: seen,
      limit: PAGE_LIMIT,
    });
    if (step === "short" || step === "over") {
      await deps
        .log(
          lines(title, response, [
            `Получено: ${response.rows.length}`,
            `Ожидалось всего: ${slice.total}`,
          ]),
        )
        .catch(() => undefined);
      return {
        done: await stop(deps, {
          ok: false,
          reason: "error",
          error: step === "short" ? SHORT : CHANGED,
        }),
        accepted,
      };
    }
    try {
      if (response.rows.length > 0) {
        if (list === "purchased")
          await deps.stagePurchased(response.rows.map((row) => row.e164));
        else await deps.stageFree(response.rows);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось записать номера.";
      return {
        done: await stop(deps, { ok: false, reason: "error", error: message }),
        accepted,
      };
    }
    seen += response.rows.length;
    accepted += response.rows.length;
    await deps.progress(list, accepted, rootTotal);
    await deps
      .log(
        lines(title, response, [
          `Получено: ${response.rows.length}`,
          `Принято: ${accepted}`,
          `Всего: ${rootTotal}`,
        ]),
      )
      .catch(() => undefined);
    if (step === "done") return { done: null, accepted };
  }
  if (seen !== slice.total) {
    return {
      done: await stop(deps, { ok: false, reason: "error", error: SHORT }),
      accepted,
    };
  }
  return { done: null, accepted };
}

async function readList(deps: WalkDeps, list: UisList): Promise<WalkResult | null> {
  const blocked = await gate(deps);
  if (blocked) return stop(deps, blocked);
  const root = await deps.count(list, { kind: "all" });
  const title = list === "purchased" ? "Купленные" : "Свободные";
  if (!root.ok) {
    await deps.log(lines(`${title}, итог`, root, [])).catch(() => undefined);
    return stop(deps, { ok: false, reason: "error", error: root.error });
  }
  await deps.progress(list, 0, root.total);
  const planned = await planSlices(
    root.total,
    async (filter) => {
      const response = await deps.count(list, filter);
      if (!response.ok) return { ok: false, error: response.error };
      await deps
        .log(
          lines(`${title}, ${describeFilter(filter)}`, response, [
            `Итог: ${response.total}`,
          ]),
        )
        .catch(() => undefined);
      return { ok: true, total: response.total };
    },
    async () => {
      const held = await gate(deps);
      return held ? held.error : null;
    },
  );
  if (!planned.ok)
    return stop(deps, { ok: false, reason: "error", error: planned.error });
  const summed = planned.slices.reduce((sum, slice) => sum + slice.total, 0);
  if (summed !== root.total) {
    return stop(deps, { ok: false, reason: "error", error: SUM_MISMATCH });
  }
  let accepted = 0;
  for (const slice of planned.slices) {
    const read = await readSlice(deps, list, slice, accepted, root.total);
    if (read.done) return read.done;
    accepted = read.accepted;
    await deps.flushLog().catch(() => undefined);
  }
  if (accepted !== root.total) {
    return stop(deps, { ok: false, reason: "error", error: SHORT });
  }
  const again = await deps.count(list, { kind: "all" });
  if (!again.ok) {
    return stop(deps, { ok: false, reason: "error", error: again.error });
  }
  if (again.total !== root.total) {
    return stop(deps, { ok: false, reason: "error", error: CHANGED });
  }
  return null;
}

/** Purchased pages, then free pages. Both lists are read in full. */
export async function runUisWalk(deps: WalkDeps): Promise<WalkResult> {
  const purchased = await readList(deps, "purchased");
  if (purchased) return purchased;
  const free = await readList(deps, "free");
  if (free) return free;
  const ready = await gate(deps);
  if (ready) return stop(deps, ready);
  try {
    await deps.prepare();
    const published = await deps.publish();
    await deps
      .log(
        `Итог: записано свободных ${published.free}, купленных ${published.purchased}\n`,
      )
      .catch(() => undefined);
    await deps.flushLog().catch(() => undefined);
    return { ok: true, free: published.free, purchased: published.purchased };
  } catch (error) {
    if (error instanceof SyncLost)
      return stop(deps, { ok: false, reason: "lost", error: LOST });
    const message =
      error instanceof Error ? error.message : "Не удалось записать номера.";
    return stop(deps, { ok: false, reason: "error", error: message });
  }
}
