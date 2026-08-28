/**
 * CDR import enrichment — descriptions, PSTN, GeoIP (shared cache).
 */

import { prisma } from "@/lib/db";
import {
  descriptionOrMissing,
  pstnOrMissing,
  stripIpPort,
} from "@/modules/enrich/types";
import {
  enrichGeoIps,
  enrichPstnPhones,
  loadDescriptionsForPhones,
} from "@/modules/enrich/lookups";
import type { GeoFields } from "@/modules/geoip/types";
import type { PstnFields } from "@/modules/pstn/types";
import { CDR_ENRICH_BACKFILL_PAGE_SIZE } from "@/modules/traffic/columns";

export type CdrEnrichKeySets = {
  phones: Set<string>;
  ips: Set<string>;
};

export type CdrEnrichLookupStats = {
  pstnCacheHits: number;
  pstnLiveLookups: number;
  geoCacheHits: number;
  geoLiveLookups: number;
};

export type CdrEnrichMaps = {
  descriptions: Map<string, string>;
  pstn: Map<string, PstnFields>;
  geo: Map<string, GeoFields>;
  stats: CdrEnrichLookupStats;
};

export type CdrEnrichFields = {
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
};

export type CdrEnrichBackfillResult = {
  backfilled: number;
  remaining: number;
  aborted: boolean;
  stats: CdrEnrichLookupStats;
};

const EMPTY_STATS: CdrEnrichLookupStats = {
  pstnCacheHits: 0,
  pstnLiveLookups: 0,
  geoCacheHits: 0,
  geoLiveLookups: 0,
};

export function createCdrEnrichKeySets(): CdrEnrichKeySets {
  return { phones: new Set(), ips: new Set() };
}

export function addPhoneEnrichKey(set: Set<string>, raw: string | undefined): void {
  const trimmed = raw?.trim() ?? "";
  if (trimmed) set.add(trimmed);
}

export function addIpEnrichKey(set: Set<string>, raw: string | undefined): void {
  const ip = stripIpPort(raw ?? "");
  if (ip) set.add(ip);
}

export function addCdrEnrichKeysFromFields(
  keys: CdrEnrichKeySets,
  fields: Record<string, string>,
): void {
  addPhoneEnrichKey(keys.phones, fields.bill_ani);
  addPhoneEnrichKey(keys.phones, fields.bill_dnis);
  addIpEnrichKey(keys.ips, fields.remote_src_sig_address);
  addIpEnrichKey(keys.ips, fields.remote_dst_sig_address);
}

function geoBits(geo: GeoFields | undefined): {
  country: string;
  city: string;
  provider: string;
} {
  return {
    country: geo?.countryIso ?? "",
    city: geo?.city ?? "",
    provider: geo?.isp ?? "",
  };
}

/** True when every requested PSTN/Geo lookup finished (including cached not-found). */
export function rowEnrichmentComplete(
  billAni: string,
  billDnis: string,
  remoteSrcSigAddress: string,
  remoteDstSigAddress: string,
  maps: Pick<CdrEnrichMaps, "pstn" | "geo">,
): boolean {
  const ani = billAni.trim();
  const dnis = billDnis.trim();
  if (ani && !maps.pstn.has(ani)) return false;
  if (dnis && !maps.pstn.has(dnis)) return false;
  const ipA = stripIpPort(remoteSrcSigAddress);
  const ipB = stripIpPort(remoteDstSigAddress);
  if (ipA && !maps.geo.has(ipA)) return false;
  if (ipB && !maps.geo.has(ipB)) return false;
  return true;
}

export function enrichFieldsForRow(
  billAni: string,
  billDnis: string,
  remoteSrcSigAddress: string,
  remoteDstSigAddress: string,
  maps: Pick<CdrEnrichMaps, "descriptions" | "pstn" | "geo">,
): CdrEnrichFields {
  const ani = billAni.trim();
  const dnis = billDnis.trim();
  const pstnA = pstnOrMissing(ani ? maps.pstn.get(ani) : undefined);
  const pstnB = pstnOrMissing(dnis ? maps.pstn.get(dnis) : undefined);
  const ipA = stripIpPort(remoteSrcSigAddress);
  const ipB = stripIpPort(remoteDstSigAddress);
  const geoA = geoBits(ipA ? maps.geo.get(ipA) : undefined);
  const geoB = geoBits(ipB ? maps.geo.get(ipB) : undefined);
  return {
    sideA: descriptionOrMissing(ani ? maps.descriptions.get(ani) : undefined),
    operatorA: pstnA.operator,
    geographyA: pstnA.geography,
    sideB: descriptionOrMissing(dnis ? maps.descriptions.get(dnis) : undefined),
    operatorB: pstnB.operator,
    geographyB: pstnB.geography,
    countryA: geoA.country,
    cityA: geoA.city,
    providerA: geoA.provider,
    countryB: geoB.country,
    cityB: geoB.city,
    providerB: geoB.provider,
  };
}

export async function loadCdrImportEnrichment(
  phones: string[],
  ips: string[],
): Promise<CdrEnrichMaps> {
  const [descriptions, pstn, geo] = await Promise.all([
    loadDescriptionsForPhones(phones),
    enrichPstnPhones(phones),
    enrichGeoIps(ips),
  ]);
  return {
    descriptions,
    pstn: pstn.byOriginal,
    geo: geo.byIp,
    stats: {
      pstnCacheHits: pstn.cacheHits,
      pstnLiveLookups: pstn.liveLookups,
      geoCacheHits: geo.cacheHits,
      geoLiveLookups: geo.liveLookups,
    },
  };
}

function addStats(
  into: CdrEnrichLookupStats,
  add: CdrEnrichLookupStats,
): void {
  into.pstnCacheHits += add.pstnCacheHits;
  into.pstnLiveLookups += add.pstnLiveLookups;
  into.geoCacheHits += add.geoCacheHits;
  into.geoLiveLookups += add.geoLiveLookups;
}

export async function backfillUnenrichedCdrRecords(opts: {
  maxRows: number;
  pageSize?: number;
  shouldAbort?: () => boolean;
}): Promise<CdrEnrichBackfillResult> {
  const pageSize = opts.pageSize ?? CDR_ENRICH_BACKFILL_PAGE_SIZE;
  const stats: CdrEnrichLookupStats = { ...EMPTY_STATS };
  let backfilled = 0;
  let aborted = false;

  while (backfilled < opts.maxRows) {
    if (opts.shouldAbort?.()) {
      aborted = true;
      break;
    }
    const take = Math.min(pageSize, opts.maxRows - backfilled);
    const rows = await prisma.cdrRecord.findMany({
      where: { enrichedAt: null },
      orderBy: [{ cdrAt: "desc" }, { cdrId: "desc" }],
      take,
      select: {
        id: true,
        billAni: true,
        billDnis: true,
        remoteSrcSigAddress: true,
        remoteDstSigAddress: true,
      },
    });
    if (rows.length === 0) break;

    const keys = createCdrEnrichKeySets();
    for (const row of rows) {
      addPhoneEnrichKey(keys.phones, row.billAni);
      addPhoneEnrichKey(keys.phones, row.billDnis);
      addIpEnrichKey(keys.ips, row.remoteSrcSigAddress);
      addIpEnrichKey(keys.ips, row.remoteDstSigAddress);
    }

    const maps = await loadCdrImportEnrichment([...keys.phones], [...keys.ips]);
    addStats(stats, maps.stats);

    const now = new Date();
    for (const row of rows) {
      if (opts.shouldAbort?.()) {
        aborted = true;
        break;
      }
      const fields = enrichFieldsForRow(
        row.billAni,
        row.billDnis,
        row.remoteSrcSigAddress,
        row.remoteDstSigAddress,
        maps,
      );
      const complete = rowEnrichmentComplete(
        row.billAni,
        row.billDnis,
        row.remoteSrcSigAddress,
        row.remoteDstSigAddress,
        maps,
      );
      await prisma.cdrRecord.update({
        where: { id: row.id },
        data: { ...fields, enrichedAt: complete ? now : null },
      });
      backfilled += 1;
    }
    if (aborted || rows.length < take) break;
  }

  const remaining = await prisma.cdrRecord.count({
    where: { enrichedAt: null },
  });
  return { backfilled, remaining, aborted, stats };
}

export function formatCdrEnrichStats(stats: CdrEnrichLookupStats): string {
  return `pstn cache=${stats.pstnCacheHits} live=${stats.pstnLiveLookups}; geo cache=${stats.geoCacheHits} live=${stats.geoLiveLookups}`;
}
