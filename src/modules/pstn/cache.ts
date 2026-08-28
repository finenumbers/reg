/**
 * pstn_phone_cache persistence (TTL 24h). Transport errors are not stored.
 */

import { prisma } from "@/lib/db";
import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import {
  isPstnCacheFresh,
  PSTN_CACHE_PRUNE_AFTER_MS,
  type PstnFields,
} from "@/modules/pstn/types";

export type CachedPstn = PstnFields & { lookedUpAt: Date };

export async function loadPstnCacheByPhones(
  phones: string[],
): Promise<Map<string, CachedPstn>> {
  const out = new Map<string, CachedPstn>();
  if (phones.length === 0) return out;
  for (const batch of chunkArray(phones, DB_IN_CHUNK)) {
    const rows = await prisma.pstnPhoneCache.findMany({
      where: { phone: { in: batch } },
    });
    for (const row of rows) {
      out.set(row.phone, {
        found: row.found,
        operator: row.operator,
        garTerritory: row.garTerritory,
        lookedUpAt: row.lookedUpAt,
      });
    }
  }
  return out;
}

export function staleOrMissingPstnPhones(
  phones: string[],
  cache: Map<string, CachedPstn>,
  now: Date = new Date(),
): string[] {
  return phones.filter((phone) => {
    const hit = cache.get(phone);
    return !hit || !isPstnCacheFresh(hit.lookedUpAt, now);
  });
}

export async function upsertPstnCache(
  phone: string,
  fields: PstnFields,
  lookedUpAt: Date = new Date(),
): Promise<void> {
  await prisma.pstnPhoneCache.upsert({
    where: { phone },
    create: {
      phone,
      found: fields.found,
      operator: fields.operator,
      garTerritory: fields.garTerritory,
      lookedUpAt,
    },
    update: {
      found: fields.found,
      operator: fields.operator,
      garTerritory: fields.garTerritory,
      lookedUpAt,
    },
  });
}

export async function pruneStalePstnCache(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PSTN_CACHE_PRUNE_AFTER_MS);
  const result = await prisma.pstnPhoneCache.deleteMany({
    where: { lookedUpAt: { lt: cutoff } },
  });
  return result.count;
}
