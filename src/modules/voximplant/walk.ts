/**
 * Purchased numbers, then every RU region. One request at a time.
 * A moved total is read again once. A free page that fills the locked total
 * is kept. A free page that equals its own larger total raises the lock.
 * The second move does not publish.
 * The next offset is the number of accepted rows, not the response `count`.
 */

import {
  DUPLICATE_NUMBER,
  PAGE_TOO_LONG,
  regionIsRead,
  type CallMeta,
  type FreeRow,
  type PhoneCategory,
  type PhoneRegion,
} from "@/modules/voximplant/parse";
import { FREE_COUNT, offsetTooFar, PURCHASED_COUNT } from "@/modules/voximplant/url";

export const CANCELLED = "Загрузка отменена. Каталог не изменён.";
export const LOST = "Загрузка прервана. Каталог не изменён.";
export const EMPTY_DIRECTORY = "В справочнике нет категорий России. Каталог не изменён.";
export const NO_REGIONS = "В справочнике нет регионов. Каталог не изменён.";
export const SHORT_LIST = "Список прочитан не полностью. Каталог не изменён.";
export const TOTAL_MOVED = "Количество номеров изменилось. Каталог не изменён.";
export const OFFSET_TOO_FAR = "Смещение больше допустимого. Каталог не изменён.";
export const OVER_TOTAL = "Список длиннее объявленного количества. Каталог не изменён.";

export type Gate = "run" | "cancel" | "lost";
export type FailReason = "lost" | "cancel" | "fail";

export type NumberPage<T> =
  | { ok: true; rows: T[]; total: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

export type TotalPage =
  | { ok: true; total: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

export type WalkResult = { ok: true } | { ok: false; error: string; reason: FailReason };

type ReadOk<T> = { kind: "ok"; total: number; firstTotal: number; rows: T[] };
type ReadShift = { kind: "shift" };
type ReadFail = { kind: "fail"; error: string; reason: FailReason };
type ReadResult<T> = ReadOk<T> | ReadShift | ReadFail;

function failed(error: string, reason: FailReason = "fail"): WalkResult {
  return { ok: false, error, reason };
}

function line(method: string, meta: CallMeta, fields: string): string {
  return `${method} ${fields} status=${meta.status} attempts=${meta.attempts} duration=${meta.durationMs}`.replace(
    /\s+/g,
    " ",
  );
}

type Selection<T> = {
  method: string;
  detail: (offset: number) => string;
  limit: number;
  fetchPage: (offset: number) => Promise<NumberPage<T>>;
  recount: () => Promise<TotalPage>;
  key: (row: T) => string;
  stage?: (rows: readonly T[]) => Promise<void>;
  drop: () => Promise<void>;
  beat: (done: number, total: number) => Promise<Gate>;
  log: (text: string) => Promise<void>;
  /**
   * A free page may fill the locked total, or raise it when the rows equal
   * that page's own larger total.
   */
  completeLockedTotal?: boolean;
};

async function readPages<T>(input: Selection<T>): Promise<ReadResult<T>> {
  let offset = 0;
  let locked: number | null = null;
  let firstTotal: number | null = null;
  let accepted = 0;
  let emptyRetries = 0;
  const seen = new Set<string>();
  const collected: T[] = [];
  while (locked == null || accepted < locked) {
    if (offsetTooFar(offset))
      return { kind: "fail", error: OFFSET_TOO_FAR, reason: "fail" };
    const gate = await input.beat(accepted, locked ?? 0);
    if (gate === "cancel") return { kind: "fail", error: CANCELLED, reason: "cancel" };
    if (gate === "lost") return { kind: "fail", error: LOST, reason: "lost" };
    const page = await input.fetchPage(offset);
    const totalText = page.ok ? ` total=${page.total} rows=${page.rows.length}` : "";
    await input.log(
      `${line(input.method, page.meta, `${input.detail(offset)}${totalText}`)}`,
    );
    if (!page.ok) return { kind: "fail", error: page.error, reason: "fail" };
    if (page.rows.length > input.limit) {
      return { kind: "fail", error: PAGE_TOO_LONG, reason: "fail" };
    }
    const pageRows = accepted + page.rows.length;
    const fillsLockedTotal =
      input.completeLockedTotal === true && locked != null && pageRows === locked;
    const raisesTotal =
      input.completeLockedTotal === true &&
      locked != null &&
      page.total > locked &&
      pageRows === page.total;
    if (locked == null) {
      locked = page.total;
      firstTotal = page.total;
    } else if (raisesTotal) locked = page.total;
    else if (page.total !== locked && !fillsLockedTotal) return { kind: "shift" };
    if (page.rows.length === 0) {
      if (locked === 0) break;
      if (emptyRetries >= 1) return { kind: "fail", error: SHORT_LIST, reason: "fail" };
      emptyRetries += 1;
      continue;
    }
    emptyRetries = 0;
    for (const row of page.rows) {
      const id = input.key(row);
      if (seen.has(id)) return { kind: "fail", error: DUPLICATE_NUMBER, reason: "fail" };
      seen.add(id);
    }
    if (accepted + page.rows.length > locked) {
      return { kind: "fail", error: OVER_TOTAL, reason: "fail" };
    }
    if (input.stage) await input.stage(page.rows);
    collected.push(...page.rows);
    accepted += page.rows.length;
    offset = accepted;
  }
  if (locked == null || firstTotal == null || accepted !== locked) {
    return { kind: "fail", error: SHORT_LIST, reason: "fail" };
  }
  return { kind: "ok", total: locked, firstTotal, rows: collected };
}

async function readStable<T>(input: Selection<T>): Promise<ReadResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await input.drop();
    const read = await readPages(input);
    if (read.kind === "fail") {
      if (
        attempt === 0 &&
        input.completeLockedTotal === true &&
        read.error === DUPLICATE_NUMBER
      ) {
        continue;
      }
      await input.drop();
      return read;
    }
    if (read.kind === "shift") continue;
    const gate = await input.beat(read.total, read.total);
    if (gate === "cancel") return { kind: "fail", error: CANCELLED, reason: "cancel" };
    if (gate === "lost") return { kind: "fail", error: LOST, reason: "lost" };
    const recount = await input.recount();
    await input.log(
      `${line(input.method, recount.meta, `${input.detail(0)} recount${recount.ok ? ` total=${recount.total}` : ""}`)}`,
    );
    if (!recount.ok) {
      await input.drop();
      return { kind: "fail", error: recount.error, reason: "fail" };
    }
    const recountMatches =
      recount.total === read.total ||
      (input.completeLockedTotal === true &&
        read.total > read.firstTotal &&
        recount.total === read.firstTotal);
    if (!recountMatches) continue;
    return read;
  }
  await input.drop();
  return { kind: "fail", error: TOTAL_MOVED, reason: "fail" };
}

export async function runVoximplantWalk(deps: {
  beat: (list: "purchased" | "free", done: number, total: number) => Promise<Gate>;
  purchasedPage: (offset: number) => Promise<NumberPage<FreeRow>>;
  purchasedRecount: () => Promise<TotalPage>;
  categories: () => Promise<
    | { ok: true; categories: PhoneCategory[]; meta: CallMeta }
    | { ok: false; error: string; meta: CallMeta }
  >;
  regions: (
    category: string,
  ) => Promise<
    | { ok: true; regions: PhoneRegion[]; meta: CallMeta }
    | { ok: false; error: string; meta: CallMeta }
  >;
  freePage: (
    category: string,
    regionId: number,
    offset: number,
  ) => Promise<NumberPage<FreeRow>>;
  freeRecount: (category: string, regionId: number) => Promise<TotalPage>;
  stagePurchased: (rows: readonly FreeRow[]) => Promise<void>;
  dropPurchased: () => Promise<void>;
  stageFree: (rows: readonly FreeRow[]) => Promise<void>;
  log: (text: string) => Promise<void>;
  addDuplicates?: (count: number) => void;
}): Promise<WalkResult> {
  const purchased = await readStable({
    method: "GetPhoneNumbers",
    detail: (offset) => `offset=${offset}`,
    limit: PURCHASED_COUNT,
    fetchPage: deps.purchasedPage,
    recount: deps.purchasedRecount,
    key: (row) => row.e164,
    stage: deps.stagePurchased,
    drop: deps.dropPurchased,
    beat: (done, total) => deps.beat("purchased", done, total),
    log: deps.log,
  });
  if (purchased.kind !== "ok") {
    return failed(
      purchased.kind === "fail" ? purchased.error : TOTAL_MOVED,
      purchased.kind === "fail" ? purchased.reason : "fail",
    );
  }

  const gate = await deps.beat("free", 0, 0);
  if (gate === "cancel") return failed(CANCELLED, "cancel");
  if (gate === "lost") return failed(LOST, "lost");
  const categories = await deps.categories();
  await deps.log(line("GetPhoneNumberCategories", categories.meta, ""));
  if (!categories.ok) return failed(categories.error);
  if (categories.categories.length === 0) return failed(EMPTY_DIRECTORY);

  let anyRegion = false;
  const freeSeen = new Set<string>();
  for (const category of categories.categories) {
    const regions = await deps.regions(category.name);
    await deps.log(
      line(
        "GetPhoneNumberRegions",
        regions.meta,
        `category=${category.name}${regions.ok ? ` regions=${regions.regions.length}` : ""}`,
      ),
    );
    if (!regions.ok) return failed(regions.error);
    if (regions.regions.length > 0) anyRegion = true;
    for (const region of regions.regions) {
      if (!regionIsRead(region)) continue;
      const read = await readStable({
        method: "GetNewPhoneNumbers",
        detail: (offset) =>
          `category=${category.name} region=${region.id} offset=${offset}`,
        limit: FREE_COUNT,
        fetchPage: (offset) => deps.freePage(category.name, region.id, offset),
        recount: () => deps.freeRecount(category.name, region.id),
        key: (row) => row.e164,
        drop: async () => undefined,
        beat: (done, total) => deps.beat("free", done, total),
        log: deps.log,
        completeLockedTotal: true,
      });
      if (read.kind !== "ok") {
        return failed(
          read.kind === "fail" ? read.error : TOTAL_MOVED,
          read.kind === "fail" ? read.reason : "fail",
        );
      }
      const fresh = read.rows.filter((row) => {
        if (freeSeen.has(row.e164)) return false;
        freeSeen.add(row.e164);
        return true;
      });
      const skipped = read.rows.length - fresh.length;
      if (skipped > 0) deps.addDuplicates?.(skipped);
      if (fresh.length > 0) await deps.stageFree(fresh);
    }
  }
  if (!anyRegion) return failed(NO_REGIONS);
  return { ok: true };
}

/** One purchased page, RU categories, regions of the first category, then one free page. */
export async function runAccessProbe(client: {
  purchased(
    offset: number,
    count: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  categories(): Promise<
    { ok: true; categories: PhoneCategory[] } | { ok: false; error: string }
  >;
  regions(
    category: string,
  ): Promise<{ ok: true; regions: PhoneRegion[] } | { ok: false; error: string }>;
  free(
    category: string,
    regionId: number,
    offset: number,
    count: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const purchased = await client.purchased(0, 1);
  if (!purchased.ok) return purchased;
  const categories = await client.categories();
  if (!categories.ok) return categories;
  const first = categories.categories[0];
  if (!first) return { ok: true };
  const regions = await client.regions(first.name);
  if (!regions.ok) return regions;
  const region = regions.regions.find(regionIsRead);
  if (!region) return { ok: true };
  return client.free(first.name, region.id, 0, 1);
}
