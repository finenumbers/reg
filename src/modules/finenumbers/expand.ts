/**
 * One PSTN range of operator INN 5406978329 becomes individual numbers.
 * Inclusive bounds. The local part is seven digits. A gap between ranges stays empty.
 */

import { isTariffNumberAdmitted } from "@/modules/traffic/tariff-match";

export const FINENUMBERS_INN = "5406978329";
const LOCAL_DIGITS = 7;
export const LOCAL_MAX = 9_999_999;
export const EXPAND_CHUNK = 500;

const ABC = /^\d{3}$/;

type RangeShape = {
  abc: string;
  rangeStart: number;
  rangeEnd: number;
  capacity: number;
  inn: string;
};

export type ExpandedNumber = {
  e164: string;
  operator: string;
  geography: string;
};

export function admitRange(row: RangeShape): string | null {
  const inn = row.inn.trim();
  if (inn !== FINENUMBERS_INN) return "В ответе чужой ИНН. Каталог не изменён.";
  if (!ABC.test(row.abc)) return "Диапазон не разобран. Каталог не изменён.";
  if (!Number.isSafeInteger(row.rangeStart) || !Number.isSafeInteger(row.rangeEnd)) {
    return "Диапазон не разобран. Каталог не изменён.";
  }
  if (row.rangeStart < 0 || row.rangeEnd > LOCAL_MAX || row.rangeStart > row.rangeEnd) {
    return "Диапазон не разобран. Каталог не изменён.";
  }
  const span = row.rangeEnd - row.rangeStart + 1;
  if (!Number.isSafeInteger(row.capacity) || row.capacity !== span) {
    return "Диапазон не разобран. Каталог не изменён.";
  }
  if (!isTariffNumberAdmitted(e164Of(row.abc, row.rangeStart))) {
    return "Диапазон не разобран. Каталог не изменён.";
  }
  return null;
}

export function e164Of(abc: string, local: number): string {
  return `7${abc}${String(local).padStart(LOCAL_DIGITS, "0")}`;
}

export function catalogOf(e164: string, phoneKeys: ReadonlySet<string>): "free" | "purchased" {
  return phoneKeys.has(e164.slice(1)) ? "purchased" : "free";
}

export function expandSlice(
  row: Omit<RangeShape, "inn"> & { operator: string; geography: string },
  from: number,
  to: number,
): ExpandedNumber[] {
  if (from < row.rangeStart || to > row.rangeEnd || from > to) {
    throw new Error("Диапазон не разобран. Каталог не изменён.");
  }
  const operator = row.operator.trim();
  const geography = row.geography.trim();
  const out: ExpandedNumber[] = [];
  for (let local = from; local <= to; local += 1) {
    const e164 = e164Of(row.abc, local);
    if (!isTariffNumberAdmitted(e164)) {
      throw new Error("Диапазон не разобран. Каталог не изменён.");
    }
    out.push({ e164, operator, geography });
  }
  return out;
}

/** Inclusive slices. A 501-number range keeps the boundary number in the second slice. */
export function sliceBounds(
  start: number,
  end: number,
  size = EXPAND_CHUNK,
): { from: number; to: number }[] {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error("Диапазон не разобран. Каталог не изменён.");
  }
  const out: { from: number; to: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const to = Math.min(end, cursor + size - 1);
    out.push({ from: cursor, to });
    cursor = to + 1;
  }
  return out;
}

export function addCapacity(total: number, capacity: number): number {
  const next = total + capacity;
  if (!Number.isSafeInteger(next)) {
    throw new Error("Диапазон не разобран. Каталог не изменён.");
  }
  return next;
}
