/**
 * Exolve list pages. A number is the digit string the tariff split already accepts.
 * Prices that are not plain decimals stay empty and the page still succeeds.
 */

import { sipoutDidDigits } from "@/modules/sipout/did";
import { KDU_TYPE_ID, RUSSIA_REGION_ID, type FreeCell } from "@/modules/exolve/url";

export const DUPLICATE_NUMBER = "В ответе повторяется номер.";
export const UNREADABLE = "Ответ площадки не разобран.";
export const NO_TOTAL = "В ответе нет общего количества.";
export const NUMBER_UNREAD = "В ответе номер не разобран.";
export const PAGE_TOO_LONG = "Страница длиннее запрошенного лимита.";
export const PLATFORM_REJECTED = "Площадка отклонила запрос.";
export const PLATFORM_ERROR = "В ответе ошибка площадки.";
export const DIRECTORY_INCOMPLETE = "Справочник не полон. Каталог не изменён.";
export const NO_FREE_CELLS = "В справочнике нет ячеек. Каталог не изменён.";
export const KDU_WITHOUT_RUSSIA = "Для KDU нет региона Россия. Каталог не изменён.";

const TYPE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,32}$/;
const LONG_DIGITS = /\d{10}/;

export type ExolveFreeRow = {
  e164: string;
  incomingPurchase: string;
  incomingPeriod: string;
};

export type DirectoryCategory = { categoryId: number };
export type DirectoryType = {
  typeId: number;
  typeName: string;
  categories: DirectoryCategory[];
};
export type DirectoryRegion = {
  regionId: number;
  parentRegionId: number | null;
};
export type Directory = {
  types: DirectoryType[];
  regions: DirectoryRegion[];
};

type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error = UNREADABLE): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasError(data: Record<string, unknown>): boolean {
  return rootError(data) != null;
}

/** A string error is shown only when it cannot carry a number or a secret. */
function platformText(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ").trim();
  if (!flat || flat.length > 200 || LONG_DIGITS.test(flat)) return PLATFORM_REJECTED;
  const lower = flat.toLowerCase();
  if (
    lower.includes("bearer") ||
    lower.includes("token") ||
    lower.includes("password") ||
    flat.includes("://")
  ) {
    return PLATFORM_REJECTED;
  }
  return flat;
}

function rootError(data: Record<string, unknown>): string | null {
  if (!("error" in data) || data.error == null) return null;
  if (typeof data.error === "string") {
    if (data.error.trim() === "") return null;
    return platformText(data.error);
  }
  return PLATFORM_ERROR;
}

function withFields(message: string, data: Record<string, unknown>): string {
  const names = Object.keys(data)
    .filter((key) => FIELD_NAME.test(key) && !LONG_DIGITS.test(key))
    .sort()
    .slice(0, 8);
  if (names.length === 0) return message;
  const text = `${message} Поля: ${names.join(", ")}.`;
  return text.length > 200 ? message : text;
}

type NumbersShape =
  | { kind: "absent" }
  | { kind: "empty" }
  | { kind: "rows"; items: unknown[] }
  | { kind: "bad" };

function numbersShape(data: Record<string, unknown>): NumbersShape {
  if (!("numbers" in data) || data.numbers == null) return { kind: "absent" };
  if (!Array.isArray(data.numbers)) return { kind: "bad" };
  if (data.numbers.length === 0) return { kind: "empty" };
  return { kind: "rows", items: data.numbers };
}

/** uint32 from a JSON number or a decimal digit string. Leading zeros are rejected. */
export function readUint32(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || value > 4_294_967_295) return null;
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > 4_294_967_295) return null;
    return parsed;
  }
  return null;
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

function readNumberField(item: Record<string, unknown>): string | null {
  const code = item.number_code;
  const name = item.number_name;
  const hasCode = code != null && code !== "";
  const hasName = name != null && name !== "";
  if (hasCode && hasName) {
    const left = readNumber(code);
    const right = readNumber(name);
    if (!left || !right || left !== right) return null;
    return left;
  }
  if (hasCode) return readNumber(code);
  if (hasName) return readNumber(name);
  return null;
}

export function parsePurchased(
  data: unknown,
  limit: number,
): Parsed<{ total: number; rows: string[] }> {
  if (!isRecord(data)) return fail();
  const platform = rootError(data);
  if (platform) return fail(platform);
  const numbers = numbersShape(data);
  if (numbers.kind === "bad") return fail(withFields(UNREADABLE, data));
  const totalMissing = !("total" in data) || data.total == null;
  if (totalMissing) {
    if (numbers.kind === "absent" && Object.keys(data).length === 0) {
      return { ok: true, total: 0, rows: [] };
    }
    return fail(withFields(NO_TOTAL, data));
  }
  const total = readUint32(data.total);
  if (total == null) return fail(withFields(UNREADABLE, data));
  if (numbers.kind === "absent" || numbers.kind === "empty") {
    return { ok: true, total, rows: [] };
  }
  if (numbers.items.length > limit) return fail(PAGE_TOO_LONG);
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const item of numbers.items) {
    if (!isRecord(item)) return fail(NUMBER_UNREAD);
    const did = readNumberField(item);
    if (!did) return fail(withFields(NUMBER_UNREAD, item));
    if (seen.has(did)) return fail(DUPLICATE_NUMBER);
    seen.add(did);
    rows.push(did);
  }
  return { ok: true, total, rows };
}

/** Recount reads total only. The rows are not admitted and not staged. */
export function parsePurchasedTotal(data: unknown): Parsed<{ total: number }> {
  if (!isRecord(data)) return fail();
  const platform = rootError(data);
  if (platform) return fail(platform);
  const totalMissing = !("total" in data) || data.total == null;
  if (totalMissing) {
    if (Object.keys(data).length === 0) return { ok: true, total: 0 };
    return fail(withFields(NO_TOTAL, data));
  }
  const total = readUint32(data.total);
  if (total == null) return fail(withFields(UNREADABLE, data));
  if ("numbers" in data && data.numbers != null && !Array.isArray(data.numbers)) {
    return fail(withFields(UNREADABLE, data));
  }
  return { ok: true, total };
}

export function parseFree(
  data: unknown,
  limit: number,
): Parsed<{ rows: ExolveFreeRow[] }> {
  if (!isRecord(data)) return fail();
  const platform = rootError(data);
  if (platform) return fail(platform);
  const numbers = numbersShape(data);
  if (numbers.kind === "bad") return fail(withFields(UNREADABLE, data));
  if (numbers.kind === "absent") {
    const keys = Object.keys(data);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === "numbers")) {
      return { ok: true, rows: [] };
    }
    return fail(withFields(UNREADABLE, data));
  }
  if (numbers.kind === "empty") return { ok: true, rows: [] };
  if (numbers.items.length > limit) return fail(PAGE_TOO_LONG);
  const rows: ExolveFreeRow[] = [];
  const seen = new Set<string>();
  for (const item of numbers.items) {
    if (!isRecord(item)) return fail(NUMBER_UNREAD);
    const did = readNumberField(item);
    if (!did) return fail(withFields(NUMBER_UNREAD, item));
    if (seen.has(did)) return fail(DUPLICATE_NUMBER);
    seen.add(did);
    rows.push({
      e164: did,
      incomingPurchase: moneyText(item.install_fee),
      incomingPeriod: moneyText(item.subscription_fee),
    });
  }
  return { ok: true, rows };
}

export function isKduType(type: { typeId: number; typeName: string }): boolean {
  return type.typeId === KDU_TYPE_ID || type.typeName === "KDU";
}

/** Regions that are not a parent of another region in this directory. */
export function leafRegionIds(regions: readonly DirectoryRegion[]): number[] {
  const parents = new Set<number>();
  for (const region of regions) {
    if (region.parentRegionId != null) parents.add(region.parentRegionId);
  }
  return regions
    .map((region) => region.regionId)
    .filter((id) => !parents.has(id))
    .sort((left, right) => left - right);
}

export function parseDirectory(data: unknown): Parsed<{ directory: Directory }> {
  if (!isRecord(data) || hasError(data)) return fail();
  if (
    !Array.isArray(data.types) ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.regions)
  ) {
    return fail(DIRECTORY_INCOMPLETE);
  }

  const types: DirectoryType[] = [];
  const typeIds = new Set<number>();
  const typeNames = new Set<string>();
  for (const item of data.types) {
    if (!isRecord(item)) return fail(DIRECTORY_INCOMPLETE);
    const typeId = readUint32(item.type_id);
    const typeName = item.type_name;
    if (typeId == null || typeof typeName !== "string" || !TYPE_NAME.test(typeName)) {
      return fail(DIRECTORY_INCOMPLETE);
    }
    if (typeIds.has(typeId) || typeNames.has(typeName)) return fail(DIRECTORY_INCOMPLETE);
    typeIds.add(typeId);
    typeNames.add(typeName);
    types.push({ typeId, typeName, categories: [] });
  }

  const categoryIds = new Set<number>();
  for (const item of data.categories) {
    if (!isRecord(item)) return fail(DIRECTORY_INCOMPLETE);
    const categoryId = readUint32(item.category_id);
    const typeId = readUint32(item.type_id);
    if (categoryId == null || typeId == null) return fail(DIRECTORY_INCOMPLETE);
    if (categoryIds.has(categoryId)) return fail(DIRECTORY_INCOMPLETE);
    categoryIds.add(categoryId);
    const type = types.find((row) => row.typeId === typeId);
    if (!type) return fail(DIRECTORY_INCOMPLETE);
    if (typeof item.type_name === "string" && item.type_name !== type.typeName) {
      return fail(DIRECTORY_INCOMPLETE);
    }
    type.categories.push({ categoryId });
  }
  if (types.some((type) => type.categories.length === 0))
    return fail(DIRECTORY_INCOMPLETE);

  const regions: DirectoryRegion[] = [];
  const regionIds = new Set<number>();
  for (const item of data.regions) {
    if (!isRecord(item)) return fail(DIRECTORY_INCOMPLETE);
    const regionId = readUint32(item.region_id);
    if (regionId == null || regionIds.has(regionId)) return fail(DIRECTORY_INCOMPLETE);
    regionIds.add(regionId);
    let parentRegionId: number | null = null;
    if ("parent_region_id" in item && item.parent_region_id != null) {
      parentRegionId = readUint32(item.parent_region_id);
      if (parentRegionId == null) return fail(DIRECTORY_INCOMPLETE);
    }
    regions.push({ regionId, parentRegionId });
  }

  types.sort((left, right) => left.typeId - right.typeId);
  for (const type of types) {
    type.categories.sort((left, right) => left.categoryId - right.categoryId);
  }
  regions.sort((left, right) => left.regionId - right.regionId);
  return { ok: true, directory: { types, regions } };
}

/** One GetFree cell per type, its categories, and every region. KDU uses Russia only. */
export function planFreeCells(directory: Directory): Parsed<{ cells: FreeCell[] }> {
  if (directory.types.length === 0) return fail(NO_FREE_CELLS);
  const hasKdu = directory.types.some((type) => isKduType(type));
  const hasOther = directory.types.some((type) => !isKduType(type));
  if (
    hasKdu &&
    !directory.regions.some((region) => region.regionId === RUSSIA_REGION_ID)
  ) {
    return fail(KDU_WITHOUT_RUSSIA);
  }
  if (hasOther && directory.regions.length === 0) return fail(DIRECTORY_INCOMPLETE);
  const cells: FreeCell[] = [];
  for (const type of directory.types) {
    const regionIds = isKduType(type)
      ? [RUSSIA_REGION_ID]
      : directory.regions.map((region) => region.regionId);
    for (const category of type.categories) {
      for (const regionId of regionIds) {
        cells.push({
          typeId: type.typeId,
          categoryId: category.categoryId,
          regionId,
        });
      }
    }
  }
  if (cells.length === 0) return fail(NO_FREE_CELLS);
  return { ok: true, cells };
}

export function scrubExolveText(key: string, text: string): string | null {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  if (!flat || flat.length > 200 || LONG_DIGITS.test(flat)) return null;
  const lower = flat.toLowerCase();
  if (
    (key && flat.includes(key)) ||
    lower.includes("bearer") ||
    lower.includes("token") ||
    lower.includes("password") ||
    flat.includes("://")
  ) {
    return null;
  }
  return flat;
}
