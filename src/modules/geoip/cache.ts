/**
 * ip_geo_cache persistence (TTL 24h). Failed lookups are not stored.
 */

import { prisma } from "@/lib/db";
import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import {
  GEOIP_CACHE_PRUNE_AFTER_MS,
  isGeoCacheFresh,
  type GeoFields,
} from "@/modules/geoip/types";

export type CachedGeo = GeoFields & { lookedUpAt: Date };

export async function loadGeoCacheByIps(
  ips: string[],
): Promise<Map<string, CachedGeo>> {
  const out = new Map<string, CachedGeo>();
  if (ips.length === 0) return out;
  for (const batch of chunkArray(ips, DB_IN_CHUNK)) {
    const rows = await prisma.ipGeoCache.findMany({
      where: { ip: { in: batch } },
    });
    for (const row of rows) {
      out.set(row.ip, {
        country: row.country,
        countryIso: row.countryIso,
        city: row.city,
        isp: row.isp,
        datasetDate: row.datasetDate,
        lookedUpAt: row.lookedUpAt,
      });
    }
  }
  return out;
}

/** Enrich treats missing countryIso as stale so pre-migration rows are refreshed. */
export function staleOrMissingIpsForEnrich(
  ips: string[],
  cache: Map<string, CachedGeo>,
  now: Date = new Date(),
): string[] {
  return ips.filter((ip) => {
    const hit = cache.get(ip);
    return (
      !hit ||
      !isGeoCacheFresh(hit.lookedUpAt, now) ||
      !hit.countryIso
    );
  });
}

export function staleOrMissingIps(
  ips: string[],
  cache: Map<string, CachedGeo>,
  now: Date = new Date(),
): string[] {
  return ips.filter((ip) => {
    const hit = cache.get(ip);
    return !hit || !isGeoCacheFresh(hit.lookedUpAt, now);
  });
}

export async function upsertGeoCache(
  ip: string,
  fields: GeoFields,
  lookedUpAt: Date = new Date(),
): Promise<void> {
  await prisma.ipGeoCache.upsert({
    where: { ip },
    create: {
      ip,
      country: fields.country,
      countryIso: fields.countryIso,
      city: fields.city,
      isp: fields.isp,
      datasetDate: fields.datasetDate,
      lookedUpAt,
    },
    update: {
      country: fields.country,
      countryIso: fields.countryIso,
      city: fields.city,
      isp: fields.isp,
      datasetDate: fields.datasetDate,
      lookedUpAt,
    },
  });
}

export async function pruneStaleGeoCache(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - GEOIP_CACHE_PRUNE_AFTER_MS);
  const result = await prisma.ipGeoCache.deleteMany({
    where: { lookedUpAt: { lt: cutoff } },
  });
  return result.count;
}
