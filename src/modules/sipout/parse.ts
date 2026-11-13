/**
 * Handbook envelopes. A list is usable only when cnt equals its length.
 */

import { sipoutDidDigits } from "@/modules/sipout/did";

const CITY_ID = /^\d{1,12}$/;

export type ParsedCities = { ok: true; ids: string[] } | { ok: false; error: string };

export type ParsedDids = { ok: true; dids: string[] } | { ok: false; error: string };

const INCOMPLETE = "Ответ площадки обрезан.";
const BAD_NUMBER = "В ответе есть номер, который нельзя записать в E.164.";
const BAD_CITIES = "Площадка не вернула список городов.";

/** Non-negative safe integer. The handbook examples are decimal strings. */
export function parseCnt(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/** City ids in first-seen order. A bad id fails the whole list. */
export function parseCityIds(data: unknown): ParsedCities {
  if (!data || typeof data !== "object") return { ok: false, error: BAD_CITIES };
  const cities = (data as { cities?: unknown }).cities;
  if (!Array.isArray(cities)) return { ok: false, error: BAD_CITIES };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const city of cities) {
    if (!city || typeof city !== "object") return { ok: false, error: BAD_CITIES };
    const id = (city as { id?: unknown }).id;
    if (typeof id !== "string" || !CITY_ID.test(id))
      return { ok: false, error: BAD_CITIES };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

/** Digit strings. cnt must match the array, and every did must be admissible. */
export function parseDidList(data: unknown): ParsedDids {
  if (!data || typeof data !== "object") return { ok: false, error: INCOMPLETE };
  const record = data as { cnt?: unknown; list?: unknown };
  const cnt = parseCnt(record.cnt);
  if (cnt == null || !Array.isArray(record.list) || record.list.length !== cnt) {
    return { ok: false, error: INCOMPLETE };
  }
  const dids: string[] = [];
  for (const item of record.list) {
    if (!item || typeof item !== "object") return { ok: false, error: BAD_NUMBER };
    const did = (item as { did?: unknown }).did;
    if (typeof did !== "string") return { ok: false, error: BAD_NUMBER };
    const digits = sipoutDidDigits(did);
    if (!digits) return { ok: false, error: BAD_NUMBER };
    dids.push(digits);
  }
  return { ok: true, dids };
}
