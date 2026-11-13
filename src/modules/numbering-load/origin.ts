/**
 * Origin of a numbering source. Stored as scheme and host. Never fetched here.
 */

export const NUMBERING_SOURCE_ORIGIN_ERROR =
  "Укажите адрес http или https без пути, параметров и логина.";

export type NumberingSourceOrigin =
  | { ok: true; origin: string | null }
  | { ok: false; error: string };

export function parseNumberingSourceOrigin(value: string): NumberingSourceOrigin {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, origin: null };
  if (trimmed.length > 2048 || trimmed.includes("\\") || trimmed.includes("..")) {
    return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  }
  if (!url.hostname) return { ok: false, error: NUMBERING_SOURCE_ORIGIN_ERROR };
  return { ok: true, origin: `${url.protocol}//${url.host}` };
}
