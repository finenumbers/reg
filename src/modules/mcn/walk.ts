/**
 * Purchased numbers, then free numbers for every country whose prefix is 7.
 * One request at a time. A short free page is not kept and does not advance.
 * A moved total is read again once. The second move does not publish.
 */

import {
  DUPLICATE_NUMBER,
  PAGE_TOO_LONG,
  russianCountries,
  type CallMeta,
  type FreeRow,
} from "@/modules/mcn/parse";
import {
  FREE_PAGE_LIMIT,
  PURCHASED_LIMIT,
  freePageTooFar,
  offsetTooFar,
} from "@/modules/mcn/url";
import type { CountriesPage, NumberPage, TotalPage } from "@/modules/mcn/client";

export const CANCELLED = "Загрузка отменена. Каталог не изменён.";
export const LOST = "Загрузка прервана. Каталог не изменён.";
export const EMPTY_COUNTRIES =
  "В справочнике нет стран с префиксом 7. Каталог не изменён.";
export const SHORT_LIST = "Список прочитан не полностью. Каталог не изменён.";
export const TOTAL_MOVED = "Количество номеров изменилось. Каталог не изменён.";
export const OFFSET_TOO_FAR = "Смещение больше допустимого. Каталог не изменён.";
export const OVER_TOTAL = "Список длиннее объявленного количества. Каталог не изменён.";
export const OFFSET_ECHO = "Смещение в ответе не совпало. Каталог не изменён.";

export type Gate = "run" | "cancel" | "lost";
export type FailReason = "lost" | "cancel" | "fail";
export type WalkResult = { ok: true } | { ok: false; error: string; reason: FailReason };

type ReadOk<T> = { kind: "ok"; total: number; rows: T[] };
type ReadShift = { kind: "shift" };
type ReadFail = { kind: "fail"; error: string; reason: FailReason };
type ReadResult<T> = ReadOk<T> | ReadShift | ReadFail;

function failed(error: string, reason: FailReason = "fail"): WalkResult {
  return { ok: false, error, reason };
}

function line(method: string, meta: CallMeta, fields: string): string {
  return `${method} ${fields} status=${meta.status} attempts=${meta.attempts} duration=${meta.durationMs}`
    .replace(/\s+/g, " ")
    .trim();
}

type Selection<T> = {
  kind: "offset" | "page";
  method: string;
  detail: (cursor: number) => string;
  limit: number;
  fetchPage: (cursor: number) => Promise<NumberPage<T>>;
  recount: () => Promise<TotalPage>;
  key: (row: T) => string;
  beat: (done: number, total: number) => Promise<Gate>;
  log: (text: string) => Promise<void>;
};

async function readPages<T>(input: Selection<T>): Promise<ReadResult<T>> {
  let cursor = input.kind === "offset" ? 0 : 1;
  let locked: number | null = null;
  let accepted = 0;
  let emptyRetries = 0;
  let shortRetries = 0;
  const seen = new Set<string>();
  const collected: T[] = [];
  while (locked == null || accepted < locked) {
    const tooFar =
      input.kind === "offset" ? offsetTooFar(cursor) : freePageTooFar(cursor);
    if (tooFar) return { kind: "fail", error: OFFSET_TOO_FAR, reason: "fail" };
    const gate = await input.beat(accepted, locked ?? 0);
    if (gate === "cancel") return { kind: "fail", error: CANCELLED, reason: "cancel" };
    if (gate === "lost") return { kind: "fail", error: LOST, reason: "lost" };
    const page = await input.fetchPage(cursor);
    const totalText = page.ok ? ` total=${page.total} rows=${page.rows.length}` : "";
    await input.log(
      `${line(input.method, page.meta, `${input.detail(cursor)}${totalText}`)}`,
    );
    if (!page.ok) return { kind: "fail", error: page.error, reason: "fail" };
    if (page.rows.length > input.limit) {
      return { kind: "fail", error: PAGE_TOO_LONG, reason: "fail" };
    }
    if (input.kind === "offset" && page.echo !== cursor) {
      return { kind: "fail", error: OFFSET_ECHO, reason: "fail" };
    }
    if (locked == null) locked = page.total;
    else if (page.total !== locked) return { kind: "shift" };
    if (page.rows.length === 0) {
      if (locked === 0) break;
      if (emptyRetries >= 1) return { kind: "fail", error: SHORT_LIST, reason: "fail" };
      emptyRetries += 1;
      continue;
    }
    emptyRetries = 0;
    if (input.kind === "page") {
      const completes = accepted + page.rows.length === locked;
      const full = page.rows.length === input.limit;
      if (!full && !completes) {
        if (shortRetries >= 1) return { kind: "fail", error: SHORT_LIST, reason: "fail" };
        shortRetries += 1;
        continue;
      }
      shortRetries = 0;
    }
    for (const row of page.rows) {
      const id = input.key(row);
      if (seen.has(id)) return { kind: "fail", error: DUPLICATE_NUMBER, reason: "fail" };
      seen.add(id);
    }
    if (accepted + page.rows.length > locked) {
      return { kind: "fail", error: OVER_TOTAL, reason: "fail" };
    }
    collected.push(...page.rows);
    accepted += page.rows.length;
    cursor = input.kind === "offset" ? accepted : cursor + 1;
  }
  if (locked == null || accepted !== locked) {
    return { kind: "fail", error: SHORT_LIST, reason: "fail" };
  }
  return { kind: "ok", total: locked, rows: collected };
}

async function readStable<T>(input: Selection<T>): Promise<ReadResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const read = await readPages(input);
    if (read.kind === "fail") return read;
    if (read.kind === "shift") continue;
    const gate = await input.beat(read.total, read.total);
    if (gate === "cancel") return { kind: "fail", error: CANCELLED, reason: "cancel" };
    if (gate === "lost") return { kind: "fail", error: LOST, reason: "lost" };
    const recount = await input.recount();
    await input.log(
      `${line(input.method, recount.meta, `${input.detail(input.kind === "offset" ? 0 : 1)} recount${recount.ok ? ` total=${recount.total}` : ""}`)}`,
    );
    if (!recount.ok) return { kind: "fail", error: recount.error, reason: "fail" };
    if (recount.total !== read.total) continue;
    return read;
  }
  return { kind: "fail", error: TOTAL_MOVED, reason: "fail" };
}

export async function runMcnWalk(deps: {
  beat: (list: "purchased" | "free", done: number, total: number) => Promise<Gate>;
  purchasedPage: (offset: number) => Promise<NumberPage<string>>;
  purchasedRecount: () => Promise<TotalPage>;
  countries: () => Promise<CountriesPage>;
  freePage: (countryCode: number, pageNumber: number) => Promise<NumberPage<FreeRow>>;
  freeRecount: (countryCode: number) => Promise<TotalPage>;
  stagePurchased: (rows: readonly string[]) => Promise<void>;
  stageFree: (rows: readonly FreeRow[]) => Promise<void>;
  log: (text: string) => Promise<void>;
}): Promise<WalkResult> {
  const purchased = await readStable({
    kind: "offset",
    method: "composite-dids",
    detail: (offset) => `offset=${offset}`,
    limit: PURCHASED_LIMIT,
    fetchPage: deps.purchasedPage,
    recount: deps.purchasedRecount,
    key: (row) => row,
    beat: (done, total) => deps.beat("purchased", done, total),
    log: deps.log,
  });
  if (purchased.kind !== "ok") {
    return failed(
      purchased.kind === "fail" ? purchased.error : TOTAL_MOVED,
      purchased.kind === "fail" ? purchased.reason : "fail",
    );
  }
  if (purchased.rows.length > 0) await deps.stagePurchased(purchased.rows);

  const gate = await deps.beat("free", 0, 0);
  if (gate === "cancel") return failed(CANCELLED, "cancel");
  if (gate === "lost") return failed(LOST, "lost");
  const countries = await deps.countries();
  await deps.log(
    line(
      "countries",
      countries.meta,
      countries.ok ? `countries=${countries.countries.length}` : "",
    ),
  );
  if (!countries.ok) return failed(countries.error);
  const codes = russianCountries(countries.countries);
  if (codes.length === 0) return failed(EMPTY_COUNTRIES);

  const freeSeen = new Set<string>();
  for (const code of codes) {
    const read = await readStable({
      kind: "page",
      method: "numbers",
      detail: (pageNumber) => `country=${code} page=${pageNumber}`,
      limit: FREE_PAGE_LIMIT,
      fetchPage: (pageNumber) => deps.freePage(code, pageNumber),
      recount: () => deps.freeRecount(code),
      key: (row) => row.e164,
      beat: (done, total) => deps.beat("free", done, total),
      log: deps.log,
    });
    if (read.kind !== "ok") {
      return failed(
        read.kind === "fail" ? read.error : TOTAL_MOVED,
        read.kind === "fail" ? read.reason : "fail",
      );
    }
    const fresh = read.rows.filter((row) => !freeSeen.has(row.e164));
    if (fresh.length > 0) await deps.stageFree(fresh);
    for (const row of fresh) freeSeen.add(row.e164);
  }
  return { ok: true };
}

export async function runAccessProbe(client: {
  purchased(offset: number, limit: number): Promise<NumberPage<string>>;
  countries(): Promise<CountriesPage>;
  free(countryCode: number, pageNumber: number): Promise<NumberPage<FreeRow>>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const purchased = await client.purchased(0, 1);
  if (!purchased.ok) return { ok: false, error: purchased.error };
  const countries = await client.countries();
  if (!countries.ok) return { ok: false, error: countries.error };
  const codes = russianCountries(countries.countries);
  if (codes.length === 0) return { ok: false, error: EMPTY_COUNTRIES };
  const free = await client.free(codes[0] ?? 0, 1);
  if (!free.ok) return { ok: false, error: free.error };
  return { ok: true };
}
