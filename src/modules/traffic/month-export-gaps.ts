/**
 * Detect and merge missing PSTN / GeoIP / billing fields without
 * overwriting values already stored on the CDR row.
 */

import {
  descriptionOrMissing,
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  pstnOrMissing,
  stripIpPort,
} from "@/modules/enrich/types";
import { isLookupIpv4 } from "@/modules/geoip/types";
import type { CdrEnrichMaps } from "@/modules/traffic/enrich-import";

export type StoredEnrichRow = {
  billAni: string;
  billDnis: string;
  remoteSrcSigAddress: string;
  remoteDstSigAddress: string;
  sideA: string;
  operatorA: string;
  geographyA: string;
  sideB: string;
  operatorB: string;
  geographyB: string;
  countryA: string;
  cityA: string;
  providerA: string;
  countryB: string;
  cityB: string;
  providerB: string;
  enrichedAt: Date | null;
};

export type MergedEnrichPatch = {
  sideA?: string;
  operatorA?: string;
  geographyA?: string;
  sideB?: string;
  operatorB?: string;
  geographyB?: string;
  countryA?: string;
  cityA?: string;
  providerA?: string;
  countryB?: string;
  cityB?: string;
  providerB?: string;
  enrichedAt?: Date;
};

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function geoIp(raw: string): string | null {
  const host = stripIpPort(raw);
  return host && isLookupIpv4(host) ? host : null;
}

export function sideNeedsFill(value: string): boolean {
  return isBlank(value);
}

export function pstnFieldNeedsFill(value: string): boolean {
  return isBlank(value);
}

export function geoSideNeedsFill(
  country: string,
  city: string,
  provider: string,
  enrichedAt: Date | null,
  ip: string | null,
): boolean {
  if (!ip) return false;
  if (enrichedAt != null) return false;
  return isBlank(country) || isBlank(city) || isBlank(provider);
}

export function collectGapKeys(row: StoredEnrichRow): {
  phones: string[];
  ips: string[];
} {
  const phones = new Set<string>();
  const ips = new Set<string>();
  const ani = row.billAni.trim();
  const dnis = row.billDnis.trim();
  const ipA = geoIp(row.remoteSrcSigAddress);
  const ipB = geoIp(row.remoteDstSigAddress);

  if (
    ani &&
    (sideNeedsFill(row.sideA) ||
      pstnFieldNeedsFill(row.operatorA) ||
      pstnFieldNeedsFill(row.geographyA))
  ) {
    phones.add(ani);
  }
  if (
    dnis &&
    (sideNeedsFill(row.sideB) ||
      pstnFieldNeedsFill(row.operatorB) ||
      pstnFieldNeedsFill(row.geographyB))
  ) {
    phones.add(dnis);
  }
  if (geoSideNeedsFill(row.countryA, row.cityA, row.providerA, row.enrichedAt, ipA) && ipA) {
    ips.add(ipA);
  }
  if (geoSideNeedsFill(row.countryB, row.cityB, row.providerB, row.enrichedAt, ipB) && ipB) {
    ips.add(ipB);
  }
  return { phones: [...phones], ips: [...ips] };
}

function applyPstn(
  currentOperator: string,
  currentGeography: string,
  phone: string,
  maps: Pick<CdrEnrichMaps, "pstn">,
): { operator?: string; geography?: string } {
  if (!maps.pstn.has(phone)) return {};
  const resolved = pstnOrMissing(maps.pstn.get(phone));
  const out: { operator?: string; geography?: string } = {};
  if (pstnFieldNeedsFill(currentOperator)) out.operator = resolved.operator;
  if (pstnFieldNeedsFill(currentGeography)) out.geography = resolved.geography;
  return out;
}

function applyGeo(
  country: string,
  city: string,
  provider: string,
  enrichedAt: Date | null,
  ip: string | null,
  maps: Pick<CdrEnrichMaps, "geo">,
): { country?: string; city?: string; provider?: string } {
  if (!geoSideNeedsFill(country, city, provider, enrichedAt, ip) || !ip) {
    return {};
  }
  if (!maps.geo.has(ip)) return {};
  const hit = maps.geo.get(ip)!;
  const out: { country?: string; city?: string; provider?: string } = {};
  if (isBlank(country)) out.country = hit.countryIso ?? "";
  if (isBlank(city)) out.city = hit.city ?? "";
  if (isBlank(provider)) out.provider = hit.isp ?? "";
  return out;
}

/** Merge lookup results into empty fields only. Sentinels and filled text stay. */
export function mergeEnrichGaps(
  row: StoredEnrichRow,
  maps: Pick<CdrEnrichMaps, "descriptions" | "pstn" | "geo">,
  now: Date = new Date(),
): { patch: MergedEnrichPatch; changed: boolean } {
  const patch: MergedEnrichPatch = {};
  const ani = row.billAni.trim();
  const dnis = row.billDnis.trim();
  const ipA = geoIp(row.remoteSrcSigAddress);
  const ipB = geoIp(row.remoteDstSigAddress);

  if (ani && sideNeedsFill(row.sideA)) {
    patch.sideA = descriptionOrMissing(maps.descriptions.get(ani));
  }
  if (dnis && sideNeedsFill(row.sideB)) {
    patch.sideB = descriptionOrMissing(maps.descriptions.get(dnis));
  }

  if (ani) {
    const pstn = applyPstn(row.operatorA, row.geographyA, ani, maps);
    if (pstn.operator !== undefined) patch.operatorA = pstn.operator;
    if (pstn.geography !== undefined) patch.geographyA = pstn.geography;
  }
  if (dnis) {
    const pstn = applyPstn(row.operatorB, row.geographyB, dnis, maps);
    if (pstn.operator !== undefined) patch.operatorB = pstn.operator;
    if (pstn.geography !== undefined) patch.geographyB = pstn.geography;
  }

  const geoA = applyGeo(row.countryA, row.cityA, row.providerA, row.enrichedAt, ipA, maps);
  if (geoA.country !== undefined) patch.countryA = geoA.country;
  if (geoA.city !== undefined) patch.cityA = geoA.city;
  if (geoA.provider !== undefined) patch.providerA = geoA.provider;
  const geoB = applyGeo(row.countryB, row.cityB, row.providerB, row.enrichedAt, ipB, maps);
  if (geoB.country !== undefined) patch.countryB = geoB.country;
  if (geoB.city !== undefined) patch.cityB = geoB.city;
  if (geoB.provider !== undefined) patch.providerB = geoB.provider;

  const merged: StoredEnrichRow = {
    ...row,
    ...patch,
    sideA: patch.sideA ?? row.sideA,
    operatorA: patch.operatorA ?? row.operatorA,
    geographyA: patch.geographyA ?? row.geographyA,
    sideB: patch.sideB ?? row.sideB,
    operatorB: patch.operatorB ?? row.operatorB,
    geographyB: patch.geographyB ?? row.geographyB,
    countryA: patch.countryA ?? row.countryA,
    cityA: patch.cityA ?? row.cityA,
    providerA: patch.providerA ?? row.providerA,
    countryB: patch.countryB ?? row.countryB,
    cityB: patch.cityB ?? row.cityB,
    providerB: patch.providerB ?? row.providerB,
  };
  const leftover = collectGapKeys(merged);
  if (leftover.phones.length === 0 && leftover.ips.length === 0 && row.enrichedAt == null) {
    patch.enrichedAt = now;
  }

  const changed = Object.keys(patch).length > 0;
  return { patch, changed };
}

export function applyPatchToRow(
  row: StoredEnrichRow,
  patch: MergedEnrichPatch,
): StoredEnrichRow {
  return {
    ...row,
    sideA: patch.sideA ?? row.sideA,
    operatorA: patch.operatorA ?? row.operatorA,
    geographyA: patch.geographyA ?? row.geographyA,
    sideB: patch.sideB ?? row.sideB,
    operatorB: patch.operatorB ?? row.operatorB,
    geographyB: patch.geographyB ?? row.geographyB,
    countryA: patch.countryA ?? row.countryA,
    cityA: patch.cityA ?? row.cityA,
    providerA: patch.providerA ?? row.providerA,
    countryB: patch.countryB ?? row.countryB,
    cityB: patch.cityB ?? row.cityB,
    providerB: patch.providerB ?? row.providerB,
    enrichedAt: patch.enrichedAt ?? row.enrichedAt,
  };
}

export { MISSING_BILLING_LABEL, MISSING_PSTN_LABEL };
