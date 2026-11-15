/**
 * Read every showcase page, then every partner page, then publish once.
 * A failed page drops the draft and leaves both catalogs.
 */

import type { RunexisMeta, RunexisPage } from "@/modules/runexis/client";
import {
  acceptShowcasePage,
  parseManagementPage,
  parseShowcasePage,
  type FreeDraft,
} from "@/modules/runexis/parse";
import { SyncLost } from "@/modules/runexis/publish";
import type { RunexisList } from "@/modules/runexis/url";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type Published = { free: number; purchased: number };

export type WalkDeps = {
  showcase: (page: number) => Promise<RunexisPage>;
  management: (page: number) => Promise<RunexisPage>;
  stillMine: () => Promise<LeaseBeat>;
  stopping: () => boolean;
  stageFree: (rows: FreeDraft[]) => Promise<void>;
  stagePurchased: (dids: string[]) => Promise<void>;
  prepare: () => Promise<void>;
  publish: () => Promise<Published>;
  dropStage: () => Promise<void>;
  progress: (list: RunexisList, page: number, total: number) => Promise<void>;
  log: (block: string) => Promise<void>;
};

export type WalkResult =
  | { ok: true; free: number; purchased: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const SHORT = "Ответ площадки обрезан. Каталог не изменён.";
const CHANGED = "Список изменился во время чтения. Каталог не изменён.";
const LOST = "Загрузка прервана. Каталог не изменён.";

const EMPTY_META: RunexisMeta = { status: 0, attempts: 1, durationMs: 0 };

function lines(title: string, page: RunexisPage, extra: string[]): string {
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
  return result;
}

async function gate(deps: WalkDeps): Promise<WalkResult | null> {
  if (deps.stopping()) return { ok: false, reason: "cancelled", error: CANCELLED };
  const beat = await deps.stillMine();
  if (beat === "cancel") return { ok: false, reason: "cancelled", error: CANCELLED };
  if (beat !== "ok") return { ok: false, reason: "lost", error: LOST };
  return null;
}

async function readShowcase(deps: WalkDeps): Promise<WalkResult | null> {
  let total: number | null = null;
  let accepted = 0;
  let page = 1;
  for (;;) {
    const blocked = await gate(deps);
    if (blocked) return stop(deps, blocked);
    const response = await deps.showcase(page);
    if (!response.ok) {
      await deps
        .log(lines(`Витрина, страница ${page}`, response, []))
        .catch(() => undefined);
      return stop(deps, { ok: false, reason: "error", error: response.error });
    }
    const parsed = parseShowcasePage(response.data);
    if (!parsed.ok || parsed.page.page !== page) {
      await deps
        .log(lines(`Витрина, страница ${page}`, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return stop(deps, {
        ok: false,
        reason: "error",
        error: parsed.ok ? SHORT : parsed.error,
      });
    }
    if (total == null) total = parsed.page.total;
    else if (parsed.page.total !== total) {
      return stop(deps, { ok: false, reason: "error", error: CHANGED });
    }
    const step = acceptShowcasePage({
      total,
      got: parsed.page.rows.length,
      acceptedBefore: accepted,
    });
    if (step === "short" || step === "over") {
      await deps
        .log(
          lines(`Витрина, страница ${page}`, response, [
            `Получено: ${parsed.page.rows.length}`,
            `Ожидалось всего: ${total}`,
          ]),
        )
        .catch(() => undefined);
      return stop(deps, {
        ok: false,
        reason: "error",
        error: step === "short" ? SHORT : CHANGED,
      });
    }
    try {
      if (parsed.page.rows.length > 0) await deps.stageFree(parsed.page.rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось записать номера.";
      return stop(deps, { ok: false, reason: "error", error: message });
    }
    accepted += parsed.page.rows.length;
    await deps.progress("showcase", page, total);
    await deps
      .log(
        lines(`Витрина, страница ${page}`, response, [
          `Получено: ${parsed.page.rows.length}`,
          `Принято: ${accepted}`,
          `Всего: ${total}`,
        ]),
      )
      .catch(() => undefined);
    if (step === "done") return null;
    page += 1;
    if (page > Math.ceil(total / 30) + 1) {
      return stop(deps, { ok: false, reason: "error", error: SHORT });
    }
  }
}

async function readManagement(deps: WalkDeps): Promise<WalkResult | null> {
  let total: number | null = null;
  let accepted = 0;
  let page = 1;
  for (;;) {
    const blocked = await gate(deps);
    if (blocked) return stop(deps, blocked);
    const response = await deps.management(page);
    if (!response.ok) {
      await deps
        .log(lines(`Купленные, страница ${page}`, response, []))
        .catch(() => undefined);
      return stop(deps, { ok: false, reason: "error", error: response.error });
    }
    const parsed = parseManagementPage(response.data);
    if (!parsed.ok || parsed.page.page !== page) {
      await deps
        .log(lines(`Купленные, страница ${page}`, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return stop(deps, {
        ok: false,
        reason: "error",
        error: parsed.ok ? SHORT : parsed.error,
      });
    }
    if (total == null) total = parsed.page.total;
    else if (parsed.page.total !== total) {
      return stop(deps, { ok: false, reason: "error", error: CHANGED });
    }
    const step = acceptShowcasePage({
      total,
      got: parsed.page.read,
      acceptedBefore: accepted,
    });
    if (step === "short" || step === "over") {
      await deps
        .log(
          lines(`Купленные, страница ${page}`, response, [
            `Получено: ${parsed.page.read}`,
            `Ожидалось всего: ${total}`,
          ]),
        )
        .catch(() => undefined);
      return stop(deps, {
        ok: false,
        reason: "error",
        error: step === "short" ? SHORT : CHANGED,
      });
    }
    try {
      if (parsed.page.rows.length > 0) await deps.stagePurchased(parsed.page.rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось записать номера.";
      return stop(deps, { ok: false, reason: "error", error: message });
    }
    accepted += parsed.page.read;
    await deps.progress("management", page, total);
    await deps
      .log(
        lines(`Купленные, страница ${page}`, response, [
          `Получено: ${parsed.page.read}`,
          `Пропущено free: ${parsed.page.skippedFree}`,
          `Куплено на странице: ${parsed.page.rows.length}`,
          `Принято: ${accepted}`,
          `Всего: ${total}`,
        ]),
      )
      .catch(() => undefined);
    if (step === "done") return null;
    page += 1;
    if (page > Math.ceil(total / 30) + 1) {
      return stop(deps, { ok: false, reason: "error", error: SHORT });
    }
  }
}

/** Both lists, then one replace. A failed list leaves both catalogs. */
export async function runRunexisWalk(deps: WalkDeps): Promise<WalkResult> {
  const showcase = await readShowcase(deps);
  if (showcase) return showcase;
  const management = await readManagement(deps);
  if (management) return management;
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
    return { ok: true, free: published.free, purchased: published.purchased };
  } catch (error) {
    if (error instanceof SyncLost)
      return stop(deps, { ok: false, reason: "lost", error: LOST });
    const message =
      error instanceof Error ? error.message : "Не удалось записать номера.";
    return stop(deps, { ok: false, reason: "error", error: message });
  }
}
