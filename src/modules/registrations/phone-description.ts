/**
 * Map phone_endpoints rows → Описание / Канальность for registration list enrichment.
 * buildPhoneDescriptionMap contract is unchanged (enrich + CDR sides).
 */

const DESCRIPTION_FIELD = "Описание";
const INIT_CAPACITY_FIELD = "ИНИЦ. емкость";

export const DEFAULT_CHANNELALITY = "Премиум";

export type PhoneEndpointDescriptionSource = {
  endpointNumber: string | null;
  name: string;
  data: unknown;
};

export type PhoneEndpointEnrichment = {
  description: string | null;
  channelality: string;
};

function asDataString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
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
  return asDataString((data as Record<string, unknown>)[INIT_CAPACITY_FIELD]);
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
 * Presence in the map means a catalog row exists. Empty ИНИЦ. емкость → «Премиум».
 * No map key = registration is not in the catalog.
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
      channelality: readInitCapacity(row.data) ?? DEFAULT_CHANNELALITY,
    });
  }
  return map;
}
