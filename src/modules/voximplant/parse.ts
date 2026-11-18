/**
 * Voximplant list pages. A number is the digit string the tariff split already accepts.
 * A leading plus is removed. 8 is not rewritten to 7. A bad price leaves that cell empty.
 */

import { sipoutDidDigits } from "@/modules/sipout/did";
import { sanitizeLogLine } from "@/modules/voximplant/log";

export const DUPLICATE_NUMBER = "В ответе повторяется номер.";
export const UNREADABLE = "Ответ площадки не разобран.";
export const NO_TOTAL = "В ответе нет общего количества.";
export const NUMBER_UNREAD = "В ответе номер не разобран.";
export const PAGE_TOO_LONG = "Страница длиннее запрошенного лимита.";
export const PLATFORM_REJECTED = "Площадка отклонила запрос.";
export const STATES_REQUIRED = "Категория требует штаты. Каталог не изменён.";
export const BAD_CATEGORY = "Имя категории не разобрано. Каталог не изменён.";
export const BAD_REGION = "Идентификатор региона не разобран. Каталог не изменён.";

const CATEGORY_NAME = /^[A-Za-z0-9_-]{1,64}$/;

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

export type PhoneCategory = { name: string };

export type PhoneRegion = {
  id: number;
  phoneCount: number | null;
};

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error = UNREADABLE): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function platformMessage(value: unknown): string {
  if (typeof value === "string") {
    const clean = sanitizeLogLine(value);
    if (!clean || clean === PLATFORM_REJECTED) return PLATFORM_REJECTED;
    return clean;
  }
  if (isRecord(value)) {
    const msg = value.msg ?? value.message;
    if (typeof msg === "string") return platformMessage(msg);
  }
  return PLATFORM_REJECTED;
}

function rootError(data: Record<string, unknown>): string | null {
  if (!("error" in data) || data.error == null || data.error === "") return null;
  return platformMessage(data.error);
}

function readTotal(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function moneyText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "";
    const text = String(value);
    return /^\d+(\.\d+)?$/.test(text) ? text : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replaceAll("\u00a0", " ");
    return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : "";
  }
  return "";
}

function readNumber(value: unknown): string | null {
  if (typeof value === "string") return sipoutDidDigits(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return sipoutDidDigits(String(value));
  }
  return null;
}

type ResultShape =
  { kind: "empty" } | { kind: "rows"; items: unknown[] } | { kind: "bad" };

function resultShape(data: Record<string, unknown>, total: number): ResultShape {
  if (!("result" in data) || data.result == null) {
    return total === 0 ? { kind: "empty" } : { kind: "rows", items: [] };
  }
  if (!Array.isArray(data.result)) return { kind: "bad" };
  if (data.result.length === 0) return { kind: "empty" };
  return { kind: "rows", items: data.result };
}

function parseList(
  data: unknown,
  limit: number,
): Parsed<{ items: unknown[]; total: number }> {
  if (!isRecord(data)) return fail();
  const error = rootError(data);
  if (error) return fail(error);
  const total = readTotal(data.total_count);
  if (total == null) return fail(NO_TOTAL);
  const shape = resultShape(data, total);
  if (shape.kind === "bad") return fail();
  const items = shape.kind === "rows" ? shape.items : [];
  if (items.length > limit) return fail(PAGE_TOO_LONG);
  return { ok: true, items, total };
}

function mapNumbers(
  items: readonly unknown[],
  prices: boolean,
): Parsed<{ rows: FreeRow[] }> {
  const seen = new Set<string>();
  const rows: FreeRow[] = [];
  for (const item of items) {
    if (!isRecord(item)) return fail(NUMBER_UNREAD);
    const e164 = readNumber(item.phone_number);
    if (!e164) return fail(NUMBER_UNREAD);
    if (seen.has(e164)) return fail(DUPLICATE_NUMBER);
    seen.add(e164);
    rows.push({
      e164,
      incomingPurchase: prices ? moneyText(item.phone_installation_price) : "",
      incomingPeriod: moneyText(item.phone_price),
    });
  }
  return { ok: true, rows };
}

export function parsePurchasedPage(
  data: unknown,
  limit: number,
): Parsed<{ rows: FreeRow[]; total: number }> {
  const list = parseList(data, limit);
  if (!list.ok) return list;
  const rows = mapNumbers(list.items, false);
  if (!rows.ok) return rows;
  return { ok: true, rows: rows.rows, total: list.total };
}

export function parseFreePage(
  data: unknown,
  limit: number,
): Parsed<{ rows: FreeRow[]; total: number }> {
  const list = parseList(data, limit);
  if (!list.ok) return list;
  const rows = mapNumbers(list.items, true);
  if (!rows.ok) return rows;
  return { ok: true, rows: rows.rows, total: list.total };
}

function flag(value: unknown): boolean | "bad" | "absent" {
  if (value == null) return "absent";
  if (value === true) return true;
  if (value === false) return false;
  return "bad";
}

/** RU categories that can be listed. `country_has_states` true stops the walk. */
export function parseCategories(data: unknown): Parsed<{ categories: PhoneCategory[] }> {
  if (!isRecord(data)) return fail();
  const error = rootError(data);
  if (error) return fail(error);
  if (!Array.isArray(data.result)) return fail();
  const categories: PhoneCategory[] = [];
  const seen = new Set<string>();
  for (const country of data.result) {
    if (!isRecord(country)) return fail();
    if (country.country_code !== "RU") continue;
    const listable = flag(country.can_list_phone_numbers);
    if (listable === "bad") return fail();
    if (listable === false) continue;
    if (!Array.isArray(country.phone_categories)) return fail();
    for (const category of country.phone_categories) {
      if (!isRecord(category)) return fail();
      const name = category.phone_category_name;
      if (typeof name !== "string" || !CATEGORY_NAME.test(name))
        return fail(BAD_CATEGORY);
      const states = flag(category.country_has_states);
      if (states === "bad") return fail();
      if (states === true) return fail(STATES_REQUIRED);
      if (seen.has(name)) continue;
      seen.add(name);
      categories.push({ name });
    }
  }
  return { ok: true, categories };
}

function readPhoneCount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/** A missing `result` array stops the walk. A repeated region id is kept once. */
export function parseRegions(data: unknown): Parsed<{ regions: PhoneRegion[] }> {
  if (!isRecord(data)) return fail();
  const error = rootError(data);
  if (error) return fail(error);
  if (!Array.isArray(data.result)) return fail();
  const regions: PhoneRegion[] = [];
  const seen = new Set<number>();
  for (const row of data.result) {
    if (!isRecord(row)) return fail(BAD_REGION);
    const id = row.phone_region_id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0)
      return fail(BAD_REGION);
    if (seen.has(id)) continue;
    seen.add(id);
    const phoneCount = readPhoneCount(row.phone_count);
    regions.push({ id, phoneCount });
  }
  return { ok: true, regions };
}

/** `phone_count` below 1 is not read. A missing or non-integer count is read. */
export function regionIsRead(region: PhoneRegion): boolean {
  return region.phoneCount == null || region.phoneCount >= 1;
}
