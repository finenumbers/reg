/**
 * Map phone_endpoints rows → Описание / Канальность for registration list enrichment.
 * buildPhoneDescriptionMap contract is unchanged (enrich + CDR sides).
 */

const DESCRIPTION_FIELD = "Описание";
const INIT_CAPACITY_FIELD = "ИНИЦ. емкость";

export type PhoneEndpointDescriptionSource = {
  endpointNumber: string | null;
  name: string;
  data: unknown;
};

export type PhoneEndpointEnrichment = {
  description: string | null;
  channelality: string | null;
};

/**
 * Same coercion as phones catalog `asString` / `asStringRecord`:
 * null → ""; number/boolean → String; no trim.
 */
function catalogCellString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function readDescription(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)[DESCRIPTION_FIELD];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInitCapacity(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = catalogCellString(
    (data as Record<string, unknown>)[INIT_CAPACITY_FIELD],
  );
  return raw.trim().length > 0 ? raw : null;
}

/**
 * Build phone → Описание map. First row wins after callers sort (e.g. by name).
 * Skips null/empty endpointNumber; does not overwrite an existing key.
 */
export function buildPhoneDescriptionMap(
  rows: PhoneEndpointDescriptionSource[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim();
    if (!number || map.has(number)) continue;
    const description = readDescription(row.data);
    if (description) {
      map.set(number, description);
    }
  }
  return map;
}

/**
 * Phone → Описание + Канальность. First row wins after callers sort (e.g. by name).
 * Канальность is the raw catalog ИНИЦ. емкость (same as Телефонные номера).
 * Trim-empty field or no catalog row → null.
 */
export function buildPhoneEndpointEnrichmentMap(
  rows: PhoneEndpointDescriptionSource[],
): Map<string, PhoneEndpointEnrichment> {
  const map = new Map<string, PhoneEndpointEnrichment>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim();
    if (!number || map.has(number)) continue;
    map.set(number, {
      description: readDescription(row.data),
      channelality: readInitCapacity(row.data),
    });
  }
  return map;
}
