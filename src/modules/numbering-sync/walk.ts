/**
 * Read every SipOut page for one source, then publish once.
 * A failed page drops the draft and leaves both catalogs.
 */

import { droppedCopies } from "@/modules/numbering-sync/card-numbers";
import { SyncLost } from "@/modules/numbering-sync/errors";
import type { PublishCounts } from "@/modules/numbering-sync/publish";
import type { SyncCatalog } from "@/modules/numbering-sync/sql";
import { parseCityIds, parseDidList, parseFreeList } from "@/modules/sipout/parse";
import type { SipoutMeta, SipoutPage } from "@/modules/sipout/client";
import type { StagedNumber } from "@/modules/numbering-sync/sql";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type WalkDeps = {
  getCities: () => Promise<SipoutPage>;
  freeList: (cityId: string) => Promise<SipoutPage>;
  connectedList: () => Promise<SipoutPage>;
  stillMine: () => Promise<LeaseBeat>;
  stage: (catalog: SyncCatalog, rows: StagedNumber[]) => Promise<number>;
  prepare: () => Promise<void>;
  publish: () => Promise<PublishCounts>;
  dropStage: () => Promise<void>;
  progress: (step: string, done: number, total: number) => Promise<void>;
  log: (block: string) => Promise<void>;
  addDuplicates?: (count: number) => void;
};

export type WalkResult =
  | { ok: true; counts: PublishCounts }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const NO_CITIES = "Площадка не вернула города. Каталог не изменён.";
const WRITE_FAILED = "Не удалось записать номера.";
const LOG_FAILED = "Не удалось записать журнал. Каталог не изменён.";

const EMPTY_META: SipoutMeta = { status: 0, attempts: 1, durationMs: 0 };

export function uniqueDids(dids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const did of dids) {
    if (seen.has(did)) continue;
    seen.add(did);
    unique.push(did);
  }
  return unique;
}

/** First price wins. A later copy of the same number is dropped. */
function uniqueStaged(rows: readonly StagedNumber[]): StagedNumber[] {
  const seen = new Set<string>();
  const unique: StagedNumber[] = [];
  for (const row of rows) {
    if (seen.has(row.e164)) continue;
    seen.add(row.e164);
    unique.push(row);
  }
  return unique;
}

function lines(title: string, page: SipoutPage, extra: string[]): string {
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

async function beat(deps: WalkDeps): Promise<WalkResult | null> {
  const state = await deps.stillMine();
  if (state === "ok") return null;
  if (state === "cancel") return { ok: false, reason: "cancelled", error: CANCELLED };
  return { ok: false, reason: "lost", error: "" };
}

async function stop(deps: WalkDeps, result: WalkResult): Promise<WalkResult> {
  await deps.dropStage();
  if (!result.ok && result.error) {
    await deps
      .log(`Итог: каталоги не изменены\nОшибка: ${result.error}\n`)
      .catch(() => undefined);
  }
  return result;
}

async function note(deps: WalkDeps, block: string): Promise<WalkResult | null> {
  try {
    await deps.log(block);
    return null;
  } catch {
    return { ok: false, reason: "error", error: LOG_FAILED };
  }
}

async function publishOwned(deps: WalkDeps): Promise<WalkResult> {
  const before = await beat(deps);
  if (before) return stop(deps, before);
  try {
    const counts = await deps.publish();
    await deps
      .log(
        [
          "--- Запись ---",
          `Удалено свободных SipOut: ${counts.deletedFree}`,
          `Записано свободных: ${counts.insertedFree}`,
          `Удалено купленных SipOut: ${counts.deletedPurchased}`,
          `Записано купленных: ${counts.insertedPurchased}`,
          "Итог: каталоги источника заменены",
          `Окончание: ${new Date().toISOString()}`,
          "",
        ].join("\n"),
      )
      .catch(() => undefined);
    return { ok: true, counts };
  } catch (error) {
    await deps.dropStage();
    if (error instanceof SyncLost) return { ok: false, reason: "lost", error: "" };
    const message =
      error instanceof Error && error.message ? error.message : WRITE_FAILED;
    await deps
      .log(`Итог: каталоги не изменены\nОшибка: ${message}\n`)
      .catch(() => undefined);
    return { ok: false, reason: "error", error: message };
  }
}

export async function runSourceWalk(deps: WalkDeps): Promise<WalkResult> {
  const first = await beat(deps);
  if (first) return stop(deps, first);
  await deps.progress("purchased", 0, 1);
  const purchased = await deps.connectedList();
  if (!purchased.ok) {
    const logged = await note(
      deps,
      lines("--- Купленные номера ---", purchased, [`Ошибка: ${purchased.error}`]),
    );
    if (logged) return stop(deps, logged);
    return stop(deps, { ok: false, reason: "error", error: purchased.error });
  }
  const bought = parseDidList(purchased.data);
  if (!bought.ok) {
    const logged = await note(
      deps,
      lines("--- Купленные номера ---", purchased, [
        `Ошибка: ${bought.error}`,
        `Индекс: ${bought.index ?? ""}`,
      ]),
    );
    if (logged) return stop(deps, logged);
    return stop(deps, { ok: false, reason: "error", error: bought.error });
  }
  const uniqueBought = uniqueDids(bought.dids).map((e164) => ({
    e164,
    incomingPeriod: "",
  }));
  const insertedBought =
    uniqueBought.length > 0 ? await deps.stage("purchased", uniqueBought) : 0;
  const purchasedNote = await note(
    deps,
    lines("--- Купленные номера ---", purchased, [
      `cnt: ${bought.dids.length}`,
      `Принято: ${uniqueBought.length}`,
      `Повторов в ответе: ${bought.dids.length - uniqueBought.length}`,
      `Повторов уже в черновике: ${uniqueBought.length - insertedBought}`,
    ]),
  );
  if (purchasedNote) return stop(deps, purchasedNote);
  deps.addDuplicates?.(
    droppedCopies(bought.dids.length, uniqueBought.length, insertedBought),
  );
  await deps.progress("purchased", 1, 1);

  const cities = await deps.getCities();
  if (!cities.ok) {
    const logged = await note(
      deps,
      lines("--- Города ---", cities, [`Ошибка: ${cities.error}`]),
    );
    if (logged) return stop(deps, logged);
    return stop(deps, { ok: false, reason: "error", error: cities.error });
  }
  const ids = parseCityIds(cities.data);
  if (!ids.ok) {
    const logged = await note(
      deps,
      lines("--- Города ---", cities, [`Ошибка: ${ids.error}`]),
    );
    if (logged) return stop(deps, logged);
    return stop(deps, { ok: false, reason: "error", error: ids.error });
  }
  const cityNote = await note(
    deps,
    lines("--- Города ---", cities, [`Городов: ${ids.ids.length}`]),
  );
  if (cityNote) return stop(deps, cityNote);
  if (ids.ids.length === 0)
    return stop(deps, { ok: false, reason: "error", error: NO_CITIES });

  await deps.progress("free", 0, ids.ids.length);
  for (let index = 0; index < ids.ids.length; index += 1) {
    const held = await beat(deps);
    if (held) return stop(deps, held);
    const cityId = ids.ids[index]!;
    const page = await deps.freeList(cityId);
    if (!page.ok) {
      const logged = await note(
        deps,
        lines(`--- Свободные номера ---`, page, [
          `Город ${index + 1} из ${ids.ids.length}, city_id=${cityId}`,
          `Ошибка: ${page.error}`,
        ]),
      );
      if (logged) return stop(deps, logged);
      return stop(deps, { ok: false, reason: "error", error: page.error });
    }
    const dids = parseFreeList(page.data);
    if (!dids.ok) {
      const logged = await note(
        deps,
        lines("--- Свободные номера ---", page, [
          `Город ${index + 1} из ${ids.ids.length}, city_id=${cityId}`,
          `Ошибка: ${dids.error}`,
          `Индекс: ${dids.index ?? ""}`,
        ]),
      );
      if (logged) return stop(deps, logged);
      return stop(deps, { ok: false, reason: "error", error: dids.error });
    }
    const unique = uniqueStaged(dids.rows);
    const inserted = unique.length > 0 ? await deps.stage("free", unique) : 0;
    const logged = await note(
      deps,
      lines("--- Свободные номера ---", page, [
        `Город ${index + 1} из ${ids.ids.length}, city_id=${cityId}`,
        `cnt: ${dids.rows.length}`,
        `Принято: ${unique.length}`,
        `Повторов в ответе: ${dids.rows.length - unique.length}`,
        `Повторов между городами: ${unique.length - inserted}`,
      ]),
    );
    if (logged) return stop(deps, logged);
    deps.addDuplicates?.(droppedCopies(dids.rows.length, unique.length, inserted));
    await deps.progress("free", index + 1, ids.ids.length);
  }

  const beforePrepare = await beat(deps);
  if (beforePrepare) return stop(deps, beforePrepare);
  await deps.progress("split", 0, 1);
  try {
    await deps.prepare();
  } catch (error) {
    if (error instanceof SyncLost)
      return stop(deps, { ok: false, reason: "lost", error: "" });
    const message =
      error instanceof Error && error.message ? error.message : WRITE_FAILED;
    return stop(deps, { ok: false, reason: "error", error: message });
  }
  await deps.progress("split", 1, 1);
  return publishOwned(deps);
}
