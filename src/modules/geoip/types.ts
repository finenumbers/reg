/**
 * GeoIP Analytics lookup — GRCHC city/country/ASN for registration IPv4s.
 */

export const GEOIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const GEOIP_CACHE_PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Background enrich: GRCHC lookup over HTTPS is often slower than 2.5s. */
export const GEOIP_LOOKUP_TIMEOUT_MS = 10_000;
/** Settings «Проверить соединение» — cold TLS + first dataset hit. */
export const GEOIP_TEST_TIMEOUT_MS = 15_000;
export const GEOIP_LOOKUP_CONCURRENCY = 4;
export const GEOIP_TEST_IP = "8.8.8.8";

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function isLookupIpv4(value: string | null | undefined): value is string {
  return Boolean(value && IPV4.test(value));
}

export function uniqueLookupIps(
  ips: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  for (const ip of ips) {
    if (isLookupIpv4(ip) && !seen.has(ip)) seen.add(ip);
  }
  return [...seen];
}

export function isGeoCacheFresh(
  lookedUpAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - lookedUpAt.getTime() < GEOIP_CACHE_TTL_MS;
}

export function normalizeGeoipBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const url = new URL(trimmed);
  return `${url.protocol}//${url.host}`;
}

export const DEFAULT_GEOIP_BASE_URL = "https://geoip.finenumbers.com";

export function resolveGeoipBaseUrl(
  raw: string | null | undefined,
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_GEOIP_BASE_URL;
  try {
    return normalizeGeoipBaseUrl(trimmed);
  } catch {
    return DEFAULT_GEOIP_BASE_URL;
  }
}

export type GeoFields = {
  country: string | null;
  countryIso: string | null;
  city: string | null;
  isp: string | null;
  datasetDate: string | null;
};

export type GeoipCredentials = {
  baseUrl: string;
  apiKey: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapLookupResponse(body: unknown): GeoFields {
  const root = asRecord(body) ?? {};
  const city = asRecord(root.city);
  const country = asRecord(root.country);
  const asn = asRecord(root.asn);
  const meta = asRecord(root.meta);
  return {
    country:
      asNullableString(country?.countryName) ??
      asNullableString(city?.countryName),
    countryIso:
      asNullableString(country?.countryIsoCode) ??
      asNullableString(city?.countryIsoCode),
    city: asNullableString(city?.cityName),
    isp: asNullableString(asn?.organization),
    datasetDate: asNullableString(meta?.datasetDate),
  };
}

export function geoipLookupUrl(baseUrl: string): string {
  return `${normalizeGeoipBaseUrl(baseUrl)}/api/v1/lookup`;
}
