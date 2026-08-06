/**
 * Map phone_endpoints rows → Описание for registration list enrichment.
 */

const DESCRIPTION_FIELD = "Описание";

export type PhoneEndpointDescriptionSource = {
  endpointNumber: string | null;
  name: string;
  data: unknown;
};

function readDescription(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)[DESCRIPTION_FIELD];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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
