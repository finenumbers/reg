/**
 * Request and response of POST /api/number-geography/pstn-fill.
 * Safe to import from the browser: no database and no PSTN client.
 */

export const PSTN_FILL_MAX_IDS = 16;
export const PSTN_FILL_MAX_ID_LENGTH = 64;

export type PstnFillItemStatus = "filled" | "cached" | "invalid" | "error";

export type PstnFillItem = {
  id: string;
  status: PstnFillItemStatus;
  operator?: string;
  geography?: string;
};

export type PstnFillResponse =
  | { configured: false }
  | { configured: true; items: PstnFillItem[] };

export function parsePstnFillIds(
  body: unknown,
): { ok: true; ids: string[] } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length > PSTN_FILL_MAX_IDS) return { ok: false };
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") return { ok: false };
    if (id.length === 0 || id.length > PSTN_FILL_MAX_ID_LENGTH) return { ok: false };
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return { ok: true, ids: unique };
}
