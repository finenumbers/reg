/**
 * Read every showcase page, then publish once.
 * A failed page drops the draft and leaves free_numbers.
 */

import type { RunexisMeta, RunexisPage } from "@/modules/runexis/client";
import { acceptShowcasePage, parseShowcasePage } from "@/modules/runexis/parse";
import { SyncLost } from "@/modules/runexis/publish";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type FreeWalkDeps = {
  showcase: (page: number) => Promise<RunexisPage>;
  stillMine: () => Promise<LeaseBeat>;
  stopping: () => boolean;
  stage: (dids: string[]) => Promise<void>;
  prepare: () => Promise<void>;
  publish: () => Promise<{ inserted: number }>;
  dropStage: () => Promise<void>;
  progress: (page: number, total: number) => Promise<void>;
  log: (block: string) => Promise<void>;
};

export type WalkResult =
  | { ok: true; inserted: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const SHORT = "Ответ площадки обрезан. Каталог не изменён.";
const CHANGED = "Список изменился во время чтения. Каталог не изменён.";

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

async function stop(deps: FreeWalkDeps, result: WalkResult): Promise<WalkResult> {
  await deps.dropStage().catch(() => undefined);
  if (!result.ok && result.error) {
    await deps
      .log(`Итог: каталог не изменён\nОшибка: ${result.error}\n`)
      .catch(() => undefined);
  }
  return result;
}

/** Pages until the accepted count equals meta.total, then one replace. */
export async function runFreeWalk(deps: FreeWalkDeps): Promise<WalkResult> {
  let total: number | null = null;
  let accepted = 0;
  let page = 1;
  for (;;) {
    if (deps.stopping())
      return stop(deps, { ok: false, reason: "cancelled", error: CANCELLED });
    const beat = await deps.stillMine();
    if (beat === "cancel")
      return stop(deps, { ok: false, reason: "cancelled", error: CANCELLED });
    if (beat !== "ok") {
      return stop(deps, {
        ok: false,
        reason: "lost",
        error: "Загрузка прервана. Каталог не изменён.",
      });
    }
    const response = await deps.showcase(page);
    if (!response.ok) {
      return stop(deps, { ok: false, reason: "error", error: response.error });
    }
    const parsed = parseShowcasePage(response.data);
    if (!parsed.ok) {
      await deps
        .log(lines(`Страница ${page}`, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return stop(deps, { ok: false, reason: "error", error: parsed.error });
    }
    if (parsed.page.page !== page) {
      return stop(deps, { ok: false, reason: "error", error: SHORT });
    }
    if (deps.stopping())
      return stop(deps, { ok: false, reason: "cancelled", error: CANCELLED });
    if (total == null) total = parsed.page.total;
    else if (parsed.page.total !== total) {
      return stop(deps, { ok: false, reason: "error", error: CHANGED });
    }
    const step = acceptShowcasePage({
      total,
      got: parsed.page.numbers.length,
      acceptedBefore: accepted,
    });
    if (step === "short" || step === "over") {
      await deps
        .log(
          lines(`Страница ${page}`, response, [
            `Получено: ${parsed.page.numbers.length}`,
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
      if (parsed.page.numbers.length > 0) await deps.stage(parsed.page.numbers);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось записать номера.";
      return stop(deps, { ok: false, reason: "error", error: message });
    }
    accepted += parsed.page.numbers.length;
    await deps.progress(page, total);
    await deps
      .log(
        lines(`Страница ${page}`, response, [
          `Получено: ${parsed.page.numbers.length}`,
          `Принято: ${accepted}`,
          `Всего: ${total}`,
        ]),
      )
      .catch(() => undefined);
    if (step === "done") break;
    page += 1;
    if (page > Math.ceil(total / 30) + 1) {
      return stop(deps, { ok: false, reason: "error", error: SHORT });
    }
  }
  if (total == null || accepted !== total) {
    return stop(deps, { ok: false, reason: "error", error: SHORT });
  }
  if (deps.stopping())
    return stop(deps, { ok: false, reason: "cancelled", error: CANCELLED });
  const ready = await deps.stillMine();
  if (ready === "cancel")
    return stop(deps, { ok: false, reason: "cancelled", error: CANCELLED });
  if (ready !== "ok") {
    return stop(deps, {
      ok: false,
      reason: "lost",
      error: "Загрузка прервана. Каталог не изменён.",
    });
  }
  try {
    await deps.prepare();
    const published = await deps.publish();
    await deps
      .log(`Итог: записано свободных ${published.inserted}\n`)
      .catch(() => undefined);
    return { ok: true, inserted: published.inserted };
  } catch (error) {
    if (error instanceof SyncLost) {
      return stop(deps, {
        ok: false,
        reason: "lost",
        error: "Загрузка прервана. Каталог не изменён.",
      });
    }
    const message =
      error instanceof Error ? error.message : "Не удалось записать номера.";
    return stop(deps, { ok: false, reason: "error", error: message });
  }
}
