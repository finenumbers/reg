import PQueue from "p-queue";
import { prisma } from "@/lib/db";
import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import { logger } from "@/lib/logger";
import { buildPhoneDescriptionMap } from "@/modules/registrations/phone-description";
import { lookupPstnPhone, PstnLookupError } from "@/modules/pstn/client";
import { loadPstnCredentials } from "@/modules/pstn/credentials";
import {
  loadPstnCacheByPhones,
  pruneStalePstnCache,
  staleOrMissingPstnPhones,
  upsertPstnCache,
} from "@/modules/pstn/cache";
import {
  PSTN_LOOKUP_CONCURRENCY,
  normalizePstnPhone,
  type PstnFields,
} from "@/modules/pstn/types";
import { lookupIpGeo, GeoipLookupError } from "@/modules/geoip/client";
import { loadGeoipCredentials } from "@/modules/geoip/credentials";
import {
  loadGeoCacheByIps,
  pruneStaleGeoCache,
  staleOrMissingIpsForEnrich,
  upsertGeoCache,
} from "@/modules/geoip/cache";
import { GEOIP_LOOKUP_CONCURRENCY, isLookupIpv4, type GeoFields } from "@/modules/geoip/types";

export async function loadDescriptionsForPhones(
  phones: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (phones.length === 0) return map;
  for (const batch of chunkArray(phones, DB_IN_CHUNK)) {
    const endpoints = await prisma.phoneEndpoint.findMany({
      where: { endpointNumber: { in: batch } },
      select: { endpointNumber: true, name: true, data: true },
      orderBy: { name: "asc" },
    });
    const part = buildPhoneDescriptionMap(endpoints);
    for (const [phone, description] of part) {
      if (!map.has(phone)) map.set(phone, description);
    }
  }
  return map;
}

export type LookupProgress = {
  current: number;
  total: number;
  cacheHits: number;
  liveLookups: number;
};

export async function enrichPstnPhones(
  originalPhones: string[],
  onProgress?: (p: LookupProgress) => void,
): Promise<{
  byOriginal: Map<string, PstnFields>;
  found: number;
  missing: number;
  cacheHits: number;
  liveLookups: number;
}> {
  await pruneStalePstnCache();
  const creds = await loadPstnCredentials();
  const byOriginal = new Map<string, PstnFields>();
  const missingFields: PstnFields = {
    found: false,
    operator: null,
    garTerritory: null,
  };

  const normalizedToOriginals = new Map<string, string[]>();
  const invalidOriginals: string[] = [];
  for (const original of originalPhones) {
    const normalized = normalizePstnPhone(original);
    if (!normalized) {
      invalidOriginals.push(original);
      continue;
    }
    const list = normalizedToOriginals.get(normalized) ?? [];
    list.push(original);
    normalizedToOriginals.set(normalized, list);
  }

  for (const original of invalidOriginals) {
    byOriginal.set(original, missingFields);
  }

  const uniqueNormalized = [...normalizedToOriginals.keys()];
  const cache = await loadPstnCacheByPhones(uniqueNormalized);
  const needed = staleOrMissingPstnPhones(uniqueNormalized, cache);
  const neededSet = new Set(needed);
  const cacheHits = uniqueNormalized.length - needed.length;
  let liveLookups = 0;
  let done = invalidOriginals.length;
  const total = originalPhones.length;

  for (const phone of uniqueNormalized) {
    if (neededSet.has(phone)) continue;
    const hit = cache.get(phone)!;
    for (const original of normalizedToOriginals.get(phone) ?? []) {
      byOriginal.set(original, {
        found: hit.found,
        operator: hit.operator,
        garTerritory: hit.garTerritory,
      });
      done += 1;
    }
  }
  onProgress?.({ current: done, total, cacheHits, liveLookups });

  if (needed.length > 0 && creds) {
    const queue = new PQueue({ concurrency: PSTN_LOOKUP_CONCURRENCY });
    await queue.addAll(
      needed.map((phone) => async () => {
        try {
          const fields = await lookupPstnPhone(phone, creds);
          await upsertPstnCache(phone, fields);
          liveLookups += 1;
          for (const original of normalizedToOriginals.get(phone) ?? []) {
            byOriginal.set(original, fields);
            done += 1;
          }
        } catch (error) {
          if (
            error instanceof PstnLookupError &&
            error.code === "RATE_LIMITED"
          ) {
            const waitMs = (error.retryAfterSec ?? 2) * 1000;
            await new Promise((r) => setTimeout(r, waitMs));
            try {
              const fields = await lookupPstnPhone(phone, creds);
              await upsertPstnCache(phone, fields);
              liveLookups += 1;
              for (const original of normalizedToOriginals.get(phone) ?? []) {
                byOriginal.set(original, fields);
                done += 1;
              }
              onProgress?.({ current: done, total, cacheHits, liveLookups });
              return;
            } catch (retryError) {
              logger.warn("pstn.enrich_retry_failed", {
                error:
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
              });
            }
          } else {
            logger.warn("pstn.enrich_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          done += (normalizedToOriginals.get(phone) ?? []).length;
        }
        onProgress?.({ current: done, total, cacheHits, liveLookups });
      }),
    );
  } else {
    for (const phone of needed) {
      for (const original of normalizedToOriginals.get(phone) ?? []) {
        byOriginal.set(original, missingFields);
        done += 1;
      }
    }
  }

  let found = 0;
  for (const fields of byOriginal.values()) {
    if (fields.found && fields.operator) found += 1;
  }

  onProgress?.({ current: total, total, cacheHits, liveLookups });
  return {
    byOriginal,
    found,
    missing: byOriginal.size - found,
    cacheHits,
    liveLookups,
  };
}

export async function enrichGeoIps(
  ips: string[],
  onProgress?: (p: LookupProgress) => void,
): Promise<{
  byIp: Map<string, GeoFields>;
  lookedUp: number;
  cacheHits: number;
  liveLookups: number;
}> {
  await pruneStaleGeoCache();
  const unique = ips.filter((ip) => isLookupIpv4(ip));
  const byIp = new Map<string, GeoFields>();
  if (unique.length === 0) {
    onProgress?.({ current: 0, total: 0, cacheHits: 0, liveLookups: 0 });
    return { byIp, lookedUp: 0, cacheHits: 0, liveLookups: 0 };
  }

  const creds = await loadGeoipCredentials();
  const cache = await loadGeoCacheByIps(unique);
  const needed = staleOrMissingIpsForEnrich(unique, cache);
  const neededSet = new Set(needed);
  const cacheHits = unique.length - needed.length;
  let liveLookups = 0;
  let done = 0;
  const total = unique.length;

  for (const ip of unique) {
    if (neededSet.has(ip)) continue;
    const hit = cache.get(ip)!;
    byIp.set(ip, {
      country: hit.country,
      countryIso: hit.countryIso,
      city: hit.city,
      isp: hit.isp,
      datasetDate: hit.datasetDate,
    });
    done += 1;
  }
  onProgress?.({ current: done, total, cacheHits, liveLookups });

  if (needed.length > 0 && creds) {
    const queue = new PQueue({ concurrency: GEOIP_LOOKUP_CONCURRENCY });
    await queue.addAll(
      needed.map((ip) => async () => {
        try {
          const fields = await lookupIpGeo(ip, creds);
          await upsertGeoCache(ip, fields);
          byIp.set(ip, fields);
          liveLookups += 1;
        } catch (error) {
          if (error instanceof GeoipLookupError && error.httpStatus === 429) {
            await new Promise((r) => setTimeout(r, 1500));
            try {
              const fields = await lookupIpGeo(ip, creds);
              await upsertGeoCache(ip, fields);
              byIp.set(ip, fields);
              liveLookups += 1;
            } catch (retryError) {
              logger.warn("geoip.enrich_retry_failed", {
                ip,
                error:
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
              });
            }
          } else {
            logger.warn("geoip.enrich_failed", {
              ip,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        done += 1;
        onProgress?.({ current: done, total, cacheHits, liveLookups });
      }),
    );
  } else {
    done += needed.length;
  }

  onProgress?.({ current: total, total, cacheHits, liveLookups });
  return { byIp, lookedUp: byIp.size, cacheHits, liveLookups };
}
