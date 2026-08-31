/**
 * Pure diff of phone → Описание maps for CDR side backfill.
 */

import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";

export type DescriptionPair = {
  phone: string;
  description: string;
};

export function serializeDescriptionMap(
  map: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [...map.keys()].sort()) {
    out[key] = map.get(key)!;
  }
  return out;
}

export function parseDescriptionMap(raw: unknown): Map<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const phone = key.trim();
    if (!phone || typeof value !== "string") continue;
    const description = value.trim();
    if (!description) continue;
    map.set(phone, description);
  }
  return map;
}

export function descriptionMapsEqual(
  left: Map<string, string>,
  right: Map<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [phone, description] of left) {
    if (right.get(phone) !== description) return false;
  }
  return true;
}

/**
 * Pairs to write onto cdr_records. Missing previous map → apply the whole catalog.
 * Removed phones become «Нет в биллинге».
 */
export function diffDescriptionMaps(
  previous: Map<string, string> | null,
  current: Map<string, string>,
): DescriptionPair[] {
  const pairs: DescriptionPair[] = [];
  if (!previous) {
    for (const [phone, description] of current) {
      pairs.push({ phone, description });
    }
    return pairs;
  }
  for (const [phone, description] of current) {
    if (previous.get(phone) !== description) {
      pairs.push({ phone, description });
    }
  }
  for (const [phone] of previous) {
    if (!current.has(phone)) {
      pairs.push({ phone, description: MISSING_BILLING_LABEL });
    }
  }
  return pairs;
}
