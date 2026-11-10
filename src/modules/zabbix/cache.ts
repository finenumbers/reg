import type { ZabbixDashboardBody } from "@/modules/zabbix/types";

const CACHE_KEY = "__reg_zabbix_dashboard_v1__";
const CACHE_TTL_MS = 60_000;

type CacheSlot = {
  at: number;
  generation: number;
  body: ZabbixDashboardBody;
};

type CacheStore = {
  generation: number;
  cached: CacheSlot | null;
  tail: Promise<void>;
};

function cacheStore(): CacheStore {
  const g = globalThis as typeof globalThis & { [CACHE_KEY]?: CacheStore };
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = { generation: 0, cached: null, tail: Promise.resolve() };
  }
  return g[CACHE_KEY];
}

/** Settings and the password replace drop a chart that still names the old graph. */
export function clearZabbixDashboardCache(): void {
  const store = cacheStore();
  store.generation += 1;
  store.cached = null;
}

export function readZabbixCache(now: number): ZabbixDashboardBody | null {
  const store = cacheStore();
  const hit = store.cached;
  if (!hit || hit.generation !== store.generation) return null;
  if (now - hit.at >= CACHE_TTL_MS) return null;
  return hit.body;
}

export function writeZabbixCache(body: ZabbixDashboardBody, generation: number, now: number): void {
  const store = cacheStore();
  if (generation !== store.generation) return;
  store.cached = { at: now, generation, body };
}

export function zabbixCacheGeneration(): number {
  return cacheStore().generation;
}

/** The test and the dashboard share one Zabbix login at a time. */
export function withZabbixLock<T>(fn: () => Promise<T>): Promise<T> {
  const store = cacheStore();
  const run = store.tail.then(fn, fn);
  store.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
