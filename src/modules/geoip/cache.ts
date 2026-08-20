/**
 * ip_geo_cache persistence (TTL 24h). Failed lookups are not stored.
 */

import { prisma } from "@/lib/db";
import {
  isGeoCacheFresh,
  type GeoFields,
} from "@/modules/geoip/types";

export type CachedGeo = GeoFields & { lookedUpAt: Date };

export async function loadGeoCacheByIps(
  ips: string[],
): Promise<Map<string, CachedGeo>> {
  const out = new Map<string, CachedGeo>();
  if (ips.length === 0) return out;
  const rows = await prisma.ipGeoCache.findMany({
    where: { ip: { in: ips } },
  });
  for (const row of rows) {
    out.set(row.ip, {
      country: row.country,
      city: row.city,
      isp: row.isp,
      datasetDate: row.datasetDate,
      lookedUpAt: row.lookedUpAt,
    });
  }
  return out;
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
      city: fields.city,
      isp: fields.isp,
      datasetDate: fields.datasetDate,
      lookedUpAt,
    },
    update: {
      country: fields.country,
      city: fields.city,
      isp: fields.isp,
      datasetDate: fields.datasetDate,
      lookedUpAt,
    },
  });
}
