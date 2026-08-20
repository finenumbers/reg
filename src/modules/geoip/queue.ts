/**
 * In-process GeoIP lookup queue (not the SSH job p-queue).
 * Single-flight per IP; concurrency 4; retry 429 once after a short wait.
 */

import PQueue from "p-queue";
import { logger } from "@/lib/logger";
import {
  lookupIpGeo,
  GeoipLookupError,
} from "@/modules/geoip/client";
import { loadGeoipCredentials } from "@/modules/geoip/credentials";
import {
  loadGeoCacheByIps,
  staleOrMissingIps,
  upsertGeoCache,
} from "@/modules/geoip/cache";
import {
  GEOIP_LOOKUP_CONCURRENCY,
  uniqueLookupIps,
} from "@/modules/geoip/types";

const QUEUE_KEY = "__reg_geoip_lookup_queue__";
const INFLIGHT_KEY = "__reg_geoip_inflight__";

function getQueue(): PQueue {
  const g = globalThis as typeof globalThis & { [QUEUE_KEY]?: PQueue };
  if (!g[QUEUE_KEY]) {
    g[QUEUE_KEY] = new PQueue({ concurrency: GEOIP_LOOKUP_CONCURRENCY });
  }
  return g[QUEUE_KEY];
}

function getInFlight(): Map<string, Promise<void>> {
  const g = globalThis as typeof globalThis & {
    [INFLIGHT_KEY]?: Map<string, Promise<void>>;
  };
  if (!g[INFLIGHT_KEY]) {
    g[INFLIGHT_KEY] = new Map();
  }
  return g[INFLIGHT_KEY];
}

async function lookupOne(ip: string): Promise<void> {
  const creds = await loadGeoipCredentials();
  if (!creds) return;

  const run = async (): Promise<void> => {
    const fields = await lookupIpGeo(ip, creds);
    await upsertGeoCache(ip, fields);
  };

  try {
    await run();
  } catch (error) {
    if (error instanceof GeoipLookupError && error.httpStatus === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await run();
        return;
      } catch (retryError) {
        logger.warn("geoip.lookup_retry_failed", {
          ip,
          error:
            retryError instanceof Error ? retryError.message : String(retryError),
        });
        return;
      }
    }
    logger.warn("geoip.lookup_failed", {
      ip,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function enrichIps(ips: string[]): Promise<void> {
  const unique = uniqueLookupIps(ips);
  if (unique.length === 0) return;

  const creds = await loadGeoipCredentials();
  if (!creds) return;

  const cache = await loadGeoCacheByIps(unique);
  const needed = staleOrMissingIps(unique, cache);
  if (needed.length === 0) return;

  const inflight = getInFlight();
  const queue = getQueue();
  const tasks: Promise<void>[] = [];

  for (const ip of needed) {
    const existing = inflight.get(ip);
    if (existing) {
      tasks.push(existing);
      continue;
    }
    const task = queue.add(async () => lookupOne(ip)).then(() => undefined);
    inflight.set(ip, task);
    void task.finally(() => {
      if (inflight.get(ip) === task) inflight.delete(ip);
    });
    tasks.push(task);
  }

  await Promise.allSettled(tasks);
}

/**
 * Fire-and-forget enrich for poll / list miss. Never throws to callers.
 */
export function enqueueStaleGeoLookups(ips: string[]): void {
  void enrichIps(ips).catch((error) => {
    logger.warn("geoip.enrich_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** Await enrich (detail / XLSX export). Swallows lookup errors. */
export async function awaitStaleGeoLookups(ips: string[]): Promise<void> {
  try {
    await enrichIps(ips);
  } catch (error) {
    logger.warn("geoip.enrich_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
