/**
 * Same base64url JSON cursor PSTN decodes in lib/api/rangesCursor.ts.
 * id must stay a positive integer: PSTN drops keyset when `!cursor.id`.
 */

import type { NumberingRow } from "@/modules/numbering-resource/types";

export function encodeNumberingCursor(row: NumberingRow): string | null {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) return null;
  if (
    !Number.isSafeInteger(row.rangeStart) ||
    !Number.isSafeInteger(row.rangeEnd) ||
    !Number.isSafeInteger(row.capacity)
  ) {
    return null;
  }
  const json = JSON.stringify({
    id: row.id,
    abc: row.abc,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
    capacity: row.capacity,
    operator: row.operator,
    garTerritory: row.garTerritory,
    inn: row.inn,
  });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
