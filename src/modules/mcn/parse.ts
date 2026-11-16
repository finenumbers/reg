/**
 * MCN Telecom list pages. A number is the digit string the tariff split already accepts.
 * A leading plus is removed. 8 is not rewritten to 7. A bad price leaves that cell empty.
 */

import { sipoutDidDigits } from "@/modules/sipout/did";

export const DUPLICATE_NUMBER = "В ответе повторяется номер.";
export const UNREADABLE = "Ответ площадки не разобран.";
export const NO_TOTAL = "В ответе нет общего количества.";
export const NUMBER_UNREAD = "В ответе номер не разобран.";
export const PAGE_TOO_LONG = "Страница длиннее запрошенного лимита.";
export const OFFSET_ECHO = "Смещение в ответе не совпало. Каталог не изменён.";
export const BAD_COUNTRY = "Страна в справочнике не разобрана. Каталог не изменён.";

const MONEY = /^\d+(\.\d{1,4})?$/;

export type CallMeta = {
  status: number;
  attempts: number;
  durationMs: number;
};

export type FreeRow = {
  e164: string;
  incomingPurchase: string;
  incomingPeriod: string;
};

export type CountryRef = {
  code: number;
  prefix: number;
};

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error = UNREADABLE): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function moneyText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "";
    const text = String(value);
    return MONEY.test(text) ? text : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replaceAll("\u00a0", " ");
    return MONEY.test(trimmed) ? trimmed : "";
  }
  return "";
}

function readFreeNumber(value: unknown): string | null {
  if (typeof value === "string") return sipoutDidDigits(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return sipoutDidDigits(String(value));
  }
  return null;
}

function readDid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return sipoutDidDigits(value);
}

function pricesOf(value: unknown): { incomingPurchase: string; incomingPeriod: string } {
  if (!isRecord(value)) return { incomingPurchase: "", incomingPeriod: "" };
  return {
    incomingPurchase: moneyText(value.price_setup),
    incomingPeriod: moneyText(value.price_per_period),
  };
}

function rowsOf(value: unknown): unknown[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return value;
}

export function parsePurchasedPage(
  data: unknown,
  limit: number,
  expectedOffset: number,
): Parsed<{ rows: string[]; total: number; offset: number }> {
  if (!isRecord(data)) return fail();
  const total = readCount(data.totalCount);
  const offset = readCount(data.offset);
  if (total == null || offset == null) return fail(NO_TOTAL);
  if (offset !== expectedOffset) return fail(OFFSET_ECHO);
  const items = rowsOf(data.data);
  if (!items) return fail();
  if (items.length > limit) return fail(PAGE_TOO_LONG);
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of items) {
    if (!isRecord(item)) return fail(NUMBER_UNREAD);
    const e164 = readDid(item.did);
    if (!e164) return fail(NUMBER_UNREAD);
    if (seen.has(e164)) return fail(DUPLICATE_NUMBER);
    seen.add(e164);
    rows.push(e164);
  }
  return { ok: true, rows, total, offset };
}

/** Recount reads the declared total and ignores the rows. */
export function parsePurchasedTotal(
  data: unknown,
  expectedOffset: number,
): Parsed<{ total: number }> {
  if (!isRecord(data)) return fail();
  const total = readCount(data.totalCount);
  const offset = readCount(data.offset);
  if (total == null || offset == null) return fail(NO_TOTAL);
  if (offset !== expectedOffset) return fail(OFFSET_ECHO);
  return { ok: true, total };
}

export function parseFreeTotal(data: unknown): Parsed<{ total: number }> {
  if (!isRecord(data)) return fail();
  const total = readCount(data.totalNumbers);
  if (total == null) return fail(NO_TOTAL);
  return { ok: true, total };
}

export function parseFreePage(
  data: unknown,
  limit: number,
): Parsed<{ rows: FreeRow[]; total: number }> {
  if (!isRecord(data)) return fail();
  const total = readCount(data.totalNumbers);
  if (total == null) return fail(NO_TOTAL);
  const items = rowsOf(data.numbers);
  if (!items) return fail();
  if (items.length > limit) return fail(PAGE_TOO_LONG);
  const seen = new Set<string>();
  const rows: FreeRow[] = [];
  for (const item of items) {
    if (!isRecord(item)) return fail(NUMBER_UNREAD);
    const e164 = readFreeNumber(item.number);
    if (!e164) return fail(NUMBER_UNREAD);
    if (seen.has(e164)) return fail(DUPLICATE_NUMBER);
    seen.add(e164);
    const prices = pricesOf(item.default_tariff);
    rows.push({ e164, ...prices });
  }
  return { ok: true, rows, total };
}

/** Every country must be readable. A repeated code fails the directory. */
export function parseCountries(data: unknown): Parsed<{ countries: CountryRef[] }> {
  if (!isRecord(data) || !Array.isArray(data.countries)) return fail();
  const countries: CountryRef[] = [];
  const seen = new Set<number>();
  for (const item of data.countries) {
    if (!isRecord(item)) return fail(BAD_COUNTRY);
    const code = readCount(item.country_code);
    const prefix = readCount(item.country_prefix);
    if (code == null || prefix == null || seen.has(code)) return fail(BAD_COUNTRY);
    seen.add(code);
    countries.push({ code, prefix });
  }
  return { ok: true, countries };
}

/** Country codes whose prefix is exactly 7. Other prefixes are not requested. */
export function russianCountries(countries: readonly CountryRef[]): number[] {
  const codes: number[] = [];
  const seen = new Set<number>();
  for (const country of countries) {
    if (country.prefix !== 7 || seen.has(country.code)) continue;
    seen.add(country.code);
    codes.push(country.code);
  }
  return codes;
}
