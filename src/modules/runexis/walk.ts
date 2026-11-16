/**
 * Read every partner page, then the code directory, then one showcase per code.
 * A failed page drops the draft and leaves both catalogs.
 */

import type { RunexisMeta, RunexisPage } from "@/modules/runexis/client";
import {
  acceptShowcasePage,
  DUPLICATE,
  parseManagementPage,
  parseRegionCodes,
  parseShowcasePage,
  rejectForeignCode,
  type FreeDraft,
} from "@/modules/runexis/parse";
import { SyncLost } from "@/modules/runexis/publish";
import {
  MANAGEMENT_LIMIT,
  SHOWCASE_LIMIT,
  type CodeSlice,
  type RunexisList,
} from "@/modules/runexis/url";

export type LeaseBeat = "ok" | "cancel" | "lost";

export type Published = { free: number; purchased: number };

export type WalkDeps = {
  codes: () => Promise<RunexisPage>;
  showcase: (page: number, slice: CodeSlice) => Promise<RunexisPage>;
  management: (page: number) => Promise<RunexisPage>;
  stillMine: () => Promise<LeaseBeat>;
  stopping: () => boolean;
  stageFree: (rows: FreeDraft[]) => Promise<number>;
  stagePurchased: (dids: string[]) => Promise<void>;
  prepare: () => Promise<void>;
  publish: () => Promise<Published>;
  dropStage: () => Promise<void>;
  progress: (
    list: RunexisList,
    page: number,
    total: number,
    accepted: number,
  ) => Promise<void>;
  log: (block: string) => Promise<void>;
  flushLog: () => Promise<void>;
};

export type WalkResult =
  | { ok: true; free: number; purchased: number }
  | { ok: false; reason: "lost" | "cancelled" | "error"; error: string };

const CANCELLED = "Загрузка отменена. Каталог не изменён.";
const NO_FREE = "Свободных номеров нет. Каталог не изменён.";
const SHORT = "Ответ площадки обрезан. Каталог не изменён.";
const CHANGED = "Список изменился во время чтения. Каталог не изменён.";
const LOST = "Загрузка прервана. Каталог не изменён.";
const CODE_READS = 3;
const STAGE_CHUNK = 500;

function changedError(previous: number, next: number): string {
  return `Список изменился во время чтения. Было ${previous}, стало ${next}. Каталог не изменён.`;
}

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
  await deps.flushLog().catch(() => undefined);
  return result;
}

async function gate(deps: WalkDeps): Promise<WalkResult | null> {
  if (deps.stopping()) return { ok: false, reason: "cancelled", error: CANCELLED };
  const beat = await deps.stillMine();
  if (beat === "cancel") return { ok: false, reason: "cancelled", error: CANCELLED };
  if (beat !== "ok") return { ok: false, reason: "lost", error: LOST };
  return null;
}

type PassResult =
  | { kind: "done"; rows: FreeDraft[] }
  | { kind: "again"; error: string }
  | { kind: "halt"; reason: "lost" | "cancelled" | "error"; error: string };

async function readPass(
  deps: WalkDeps,
  slice: CodeSlice,
  draftBefore: number,
  attempt: number,
): Promise<PassResult> {
  const seen = new Set<string>();
  const buffered: FreeDraft[] = [];
  let total: number | null = null;
  let page = 1;
  for (;;) {
    const blocked = await gate(deps);
    if (blocked && !blocked.ok) {
      return { kind: "halt", reason: blocked.reason, error: blocked.error };
    }
    const response = await deps.showcase(page, slice);
    const title = `Витрина, код ${slice.code}, страница ${page}, попытка ${attempt}`;
    if (!response.ok) {
      await deps.log(lines(title, response, [])).catch(() => undefined);
      return { kind: "halt", reason: "error", error: response.error };
    }
    const parsed = parseShowcasePage(response.data);
    if (!parsed.ok) {
      await deps
        .log(lines(title, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      if (parsed.error === DUPLICATE) return { kind: "again", error: parsed.error };
      return { kind: "halt", reason: "error", error: parsed.error };
    }
    if (parsed.page.page !== page) {
      await deps
        .log(lines(title, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return { kind: "halt", reason: "error", error: SHORT };
    }
    const foreign = rejectForeignCode(parsed.page.rows, slice.code);
    if (foreign) {
      await deps
        .log(lines(title, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return { kind: "again", error: foreign };
    }
    if (total == null) total = parsed.page.total;
    else if (parsed.page.total !== total) {
      await deps
        .log(
          lines(title, response, [
            `Всего было: ${total}`,
            `Всего стало: ${parsed.page.total}`,
          ]),
        )
        .catch(() => undefined);
      return { kind: "again", error: changedError(total, parsed.page.total) };
    }
    if (parsed.page.rows.some((row) => seen.has(row.e164))) {
      await deps
        .log(lines(title, response, ["Итог: ответ не принят"]))
        .catch(() => undefined);
      return { kind: "again", error: DUPLICATE };
    }
    const step = acceptShowcasePage({
      total,
      got: parsed.page.rows.length,
      acceptedBefore: seen.size,
      limit: SHOWCASE_LIMIT,
    });
    if (step === "short" || step === "over") {
      await deps
        .log(
          lines(title, response, [
            `Получено: ${parsed.page.rows.length}`,
            `Ожидалось всего: ${total}`,
          ]),
        )
        .catch(() => undefined);
      return { kind: "again", error: step === "short" ? SHORT : CHANGED };
    }
    for (const row of parsed.page.rows) {
      seen.add(row.e164);
      buffered.push(row);
    }
    await deps.progress("showcase", page, total, draftBefore + seen.size);
    await deps
      .log(
        lines(title, response, [
          `Получено: ${parsed.page.rows.length}`,
          `Принято: ${seen.size}`,
          `Всего: ${total}`,
          `В черновике: ${draftBefore + seen.size}`,
        ]),
      )
      .catch(() => undefined);
    if (step === "done") return { kind: "done", rows: buffered };
    page += 1;
    if (page > Math.ceil(total / SHOWCASE_LIMIT) + 1) {
      return { kind: "again", error: SHORT };
    }
  }
}

async function stageChunks(
  deps: WalkDeps,
  rows: FreeDraft[],
  draftBefore: number,
): Promise<{ done: WalkResult | null; draft: number }> {
  let draft = draftBefore;
  for (let offset = 0; offset < rows.length; offset += STAGE_CHUNK) {
    const blocked = await gate(deps);
    if (blocked) return { done: await stop(deps, blocked), draft };
    const chunk = rows.slice(offset, offset + STAGE_CHUNK);
    try {
      draft += await deps.stageFree(chunk);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось записать номера.";
      return {
        done: await stop(deps, { ok: false, reason: "error", error: message }),
        draft,
      };
    }
    await deps.progress("showcase", 0, rows.length, draft);
  }
  return { done: null, draft };
}

async function readSlice(
  deps: WalkDeps,
  slice: CodeSlice,
  draftBefore: number,
): Promise<{ done: WalkResult | null; draft: number }> {
  let draft = draftBefore;
  for (let attempt = 1; attempt <= CODE_READS; attempt += 1) {
    if (attempt > 1) await deps.progress("showcase", 0, 0, draft);
    const pass = await readPass(deps, slice, draft, attempt);
    if (pass.kind === "halt") {
      return {
        done: await stop(deps, {
          ok: false,
          reason: pass.reason,
          error: pass.error,
        }),
        draft,
      };
    }
    if (pass.kind === "done") return stageChunks(deps, pass.rows, draft);
    await deps
      .log(`Витрина, код ${slice.code}, попытка ${attempt}\n${pass.error}\n`)
      .catch(() => undefined);
    await deps.flushLog().catch(() => undefined);
    if (attempt === CODE_READS) {
      return {
        done: await stop(deps, { ok: false, reason: "error", error: pass.error }),
        draft,
      };
    }
  }
  return {
    done: await stop(deps, { ok: false, reason: "error", error: SHORT }),
    draft,
  };
}

async function readFreeByCode(deps: WalkDeps): Promise<WalkResult | null> {
  const blocked = await gate(deps);
  if (blocked) return stop(deps, blocked);
  const response = await deps.codes();
  if (!response.ok) {
    await deps.log(lines("Коды", response, [])).catch(() => undefined);
    return stop(deps, { ok: false, reason: "error", error: response.error });
  }
  const parsed = parseRegionCodes(response.data);
  if (!parsed.ok) {
    await deps
      .log(lines("Коды", response, ["Итог: ответ не принят"]))
      .catch(() => undefined);
    return stop(deps, { ok: false, reason: "error", error: parsed.error });
  }
  await deps
    .log(lines("Коды", response, [`Кодов: ${parsed.slices.length}`]))
    .catch(() => undefined);
  await deps.flushLog().catch(() => undefined);
  let draft = 0;
  await deps.progress("showcase", 0, 0, draft);
  for (const slice of parsed.slices) {
    const read = await readSlice(deps, slice, draft);
    if (read.done) return read.done;
    draft = read.draft;
    await deps.flushLog().catch(() => undefined);
  }
  if (draft === 0) {
    return stop(deps, { ok: false, reason: "error", error: NO_FREE });
  }
  return null;
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
      limit: MANAGEMENT_LIMIT,
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
    await deps.progress("management", page, total, accepted);
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
    if (page > Math.ceil(total / MANAGEMENT_LIMIT) + 1) {
      return stop(deps, { ok: false, reason: "error", error: SHORT });
    }
  }
}

/** Purchased pages, then the code directory, then one showcase per code. */
export async function runRunexisWalk(deps: WalkDeps): Promise<WalkResult> {
  const management = await readManagement(deps);
  if (management) return management;
  const showcase = await readFreeByCode(deps);
  if (showcase) return showcase;
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
