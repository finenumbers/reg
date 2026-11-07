/**
 * Snapshot of DID purchased numbers for «Управление РТУ».
 * A walk publishes only when every page agrees on total and the object
 * count matches it. The previous generation stays visible until then.
 */

import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { DidClientError, listDidPurchasedNumbers } from "@/modules/did/client";
import { loadDidCredentials } from "@/modules/did/credentials";
import { DID_LIST_TIMEOUT_MS, type DidCredentials } from "@/modules/did/types";
import { geographyProviderLabel } from "@/modules/rtu/source-label";
import { geographyMatchKey } from "@/modules/rtu/sql";
import {
  CATALOG_EXPORT_PAGE_SIZE,
  loadCatalogPage,
} from "@/modules/table-export/page-size";
import { didRetryDelayMs, drainOffsetPages } from "@/modules/table-export/pages";

export const DID_SOURCE_REFRESH_MS = 5 * 60 * 1000;
export const DID_SOURCE_LEASE_MS = 2 * 60 * 1000;
export const DID_SOURCE_MAX_TOTAL = 250_000;
const INSERT_CHUNK = 1_000;
const PROVIDER_MAX = 200;

export class DidSnapshotError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DidSnapshotError";
  }
}

export type DidSourceRow = {
  matchKey: string;
  displayNumber: string;
  provider: string;
  rowId: string;
};

export type DidSnapshotState = {
  generation: number;
  refreshedAt: Date | null;
  attemptedAt: Date | null;
};

export type PurchasedWalk = {
  total: number | null;
  seen: number;
  pairs: Set<string>;
  items: { msisdn: string; providerCode: string }[];
};

type PurchasedPage = {
  items: unknown[];
  total: number;
  pageSize?: number;
};

export type DidSnapshotDeps = {
  now: () => Date;
  newToken: () => string;
  loadCreds: () => Promise<DidCredentials | null>;
  readState: () => Promise<DidSnapshotState>;
  tryLease: (token: string, now: Date, until: Date) => Promise<boolean>;
  heartbeat: (token: string, until: Date) => Promise<boolean>;
  release: (token: string) => Promise<void>;
  markAttempt: (token: string, at: Date) => Promise<void>;
  deleteGeneration: (generation: number) => Promise<void>;
  deleteOtherGenerations: (keep: number) => Promise<void>;
  insertRows: (generation: number, rows: readonly DidSourceRow[]) => Promise<void>;
  publish: (expected: number, next: number, token: string, at: Date) => Promise<boolean>;
  loadPage: (
    page: number,
    pageSize: number,
    creds: DidCredentials,
  ) => Promise<PurchasedPage>;
};

export type DidSnapshotResult =
  { status: "published" } | { status: "skipped" } | { status: "kept"; code: string };

export function didSnapshotIsFresh(refreshedAt: Date | null, now: Date): boolean {
  if (!refreshedAt) return false;
  return now.getTime() - refreshedAt.getTime() < DID_SOURCE_REFRESH_MS;
}

/** Digits of a full number. An 11-digit 8-prefix becomes the 7-prefix form. */
export function geographyDisplayNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) return digits;
  if (/^8\d{10}$/.test(digits)) return `7${digits.slice(1)}`;
  if (digits) return digits;
  return trimmed;
}

export function geographyDidRowId(matchKey: string): string {
  const natural = `did:${matchKey}`;
  if (natural.length <= 64) return natural;
  return `did:${createHash("sha256").update(matchKey).digest("hex").slice(0, 32)}`;
}

export function createPurchasedWalk(): PurchasedWalk {
  return { total: null, seen: 0, pairs: new Set(), items: [] };
}

export function notePurchasedTotal(walk: PurchasedWalk, total: number): void {
  if (!Number.isInteger(total) || total < 0 || total > DID_SOURCE_MAX_TOTAL) {
    throw new DidSnapshotError("TOTAL");
  }
  if (walk.total == null) walk.total = total;
  else if (walk.total !== total) throw new DidSnapshotError("TOTAL_CHANGED");
}

function readMsisdn(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function readProviderCode(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return null;
}

export function acceptPurchasedItems(
  walk: PurchasedWalk,
  items: readonly unknown[],
): void {
  for (const raw of items) {
    walk.seen += 1;
    if (!raw || typeof raw !== "object") throw new DidSnapshotError("KIND");
    const record = raw as Record<string, unknown>;
    if (record.inventory_kind !== "purchased") throw new DidSnapshotError("KIND");
    const msisdn = readMsisdn(record.msisdn);
    const providerCode = readProviderCode(record.provider_code);
    if (msisdn == null || providerCode == null) throw new DidSnapshotError("MSISDN");
    if (!msisdn) continue;
    const pairKey = `${msisdn}\0${providerCode}`;
    if (walk.pairs.has(pairKey)) throw new DidSnapshotError("DUPLICATE");
    walk.pairs.add(pairKey);
    walk.items.push({ msisdn, providerCode });
  }
}

function pickDisplay(displays: readonly string[]): string {
  const seven = displays.filter((value) => /^7\d{10}$/.test(value)).sort();
  if (seven.length > 0) return seven[0]!;
  return [...displays].sort()[0] ?? "";
}

export function collapseDidSources(
  items: readonly { msisdn: string; providerCode: string }[],
): DidSourceRow[] {
  const groups = new Map<string, { displays: string[]; providers: Set<string> }>();
  for (const item of items) {
    const matchKey = geographyMatchKey(item.msisdn);
    if (!matchKey) continue;
    const group = groups.get(matchKey) ?? { displays: [], providers: new Set() };
    group.displays.push(geographyDisplayNumber(item.msisdn));
    const label = geographyProviderLabel(item.providerCode);
    if (label) group.providers.add(label.slice(0, PROVIDER_MAX));
    groups.set(matchKey, group);
  }
  const rows: DidSourceRow[] = [];
  for (const [matchKey, group] of groups) {
    const provider = group.providers.size === 1 ? [...group.providers][0]! : "";
    rows.push({
      matchKey,
      displayNumber: pickDisplay(group.displays),
      provider,
      rowId: geographyDidRowId(matchKey),
    });
  }
  rows.sort((a, b) => a.matchKey.localeCompare(b.matchKey));
  return rows;
}

export function finishPurchasedWalk(walk: PurchasedWalk): DidSourceRow[] {
  if (walk.total == null || walk.seen !== walk.total) throw new DidSnapshotError("SHORT");
  return collapseDidSources(walk.items);
}

export async function collectPurchasedSources(opts: {
  load: (page: number, pageSize: number) => Promise<PurchasedPage>;
  heartbeat: () => Promise<boolean>;
}): Promise<DidSourceRow[]> {
  const walk = createPurchasedWalk();
  let pageSize = CATALOG_EXPORT_PAGE_SIZE;
  await drainOffsetPages({
    pageSize: CATALOG_EXPORT_PAGE_SIZE,
    retryDelayMs: didRetryDelayMs,
    load: async (page) => {
      if (!(await opts.heartbeat())) throw new DidSnapshotError("LEASE");
      const loaded = await loadCatalogPage({
        page,
        pageSize,
        load: (size) => opts.load(page, size),
      });
      pageSize = loaded.pageSize;
      notePurchasedTotal(walk, loaded.value.total);
      return {
        items: loaded.value.items,
        total: loaded.value.total,
        pageSize: loaded.pageSize,
      };
    },
    onPage: (items) => {
      acceptPurchasedItems(walk, items);
    },
  });
  return finishPurchasedWalk(walk);
}

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + DID_SOURCE_LEASE_MS);
}

function resultCode(error: unknown): string {
  if (error instanceof DidSnapshotError) return error.code;
  if (error instanceof DidClientError) return error.code;
  return "ERROR";
}

function snapshotDue(state: DidSnapshotState, now: Date): boolean {
  return (
    !didSnapshotIsFresh(state.refreshedAt, now) &&
    !didSnapshotIsFresh(state.attemptedAt, now)
  );
}

async function keepSnapshot(
  deps: DidSnapshotDeps,
  token: string,
  code: string,
): Promise<DidSnapshotResult> {
  try {
    await deps.markAttempt(token, deps.now());
  } catch (error) {
    logger.warn("number_geography.did_snapshot_attempt", { code: resultCode(error) });
  }
  return { status: "kept", code };
}

export async function syncDidSnapshot(deps: DidSnapshotDeps): Promise<DidSnapshotResult> {
  const first = await deps.readState();
  if (!snapshotDue(first, deps.now())) return { status: "skipped" };
  const creds = await deps.loadCreds();
  if (!creds) return { status: "skipped" };
  const token = deps.newToken();
  const acquired = await deps.tryLease(token, deps.now(), leaseUntil(deps.now()));
  if (!acquired) return { status: "skipped" };

  let owned: number | null = null;
  let published = false;
  try {
    const state = await deps.readState();
    if (!snapshotDue(state, deps.now())) return { status: "skipped" };
    owned = state.generation + 1;
    await deps.deleteOtherGenerations(state.generation);
    const rows = await collectPurchasedSources({
      load: (page, pageSize) => deps.loadPage(page, pageSize, creds),
      heartbeat: () => deps.heartbeat(token, leaseUntil(deps.now())),
    });
    if (!(await deps.heartbeat(token, leaseUntil(deps.now())))) {
      return keepSnapshot(deps, token, "LEASE");
    }
    await deps.insertRows(owned, rows);
    const ok = await deps.publish(state.generation, owned, token, deps.now());
    if (!ok) return keepSnapshot(deps, token, "PUBLISH");
    published = true;
    try {
      await deps.deleteOtherGenerations(owned);
    } catch (error) {
      logger.warn("number_geography.did_snapshot_cleanup", { code: resultCode(error) });
    }
    return { status: "published" };
  } catch (error) {
    return keepSnapshot(deps, token, resultCode(error));
  } finally {
    if (owned != null && !published) {
      try {
        await deps.deleteGeneration(owned);
      } catch (error) {
        logger.warn("number_geography.did_snapshot_cleanup", { code: resultCode(error) });
      }
    }
    try {
      await deps.release(token);
    } catch (error) {
      logger.warn("number_geography.did_snapshot_release", { code: resultCode(error) });
    }
  }
}

const defaultDeps: DidSnapshotDeps = {
  now: () => new Date(),
  newToken: () => randomUUID(),
  loadCreds: loadDidCredentials,
  async readState() {
    const row = await prisma.geographyDidState.findUnique({ where: { id: 1 } });
    return {
      generation: row?.generation ?? 0,
      refreshedAt: row?.refreshedAt ?? null,
      attemptedAt: row?.attemptedAt ?? null,
    };
  },
  async markAttempt(token, at) {
    await prisma.$executeRaw`
      UPDATE geography_did_state
      SET "attemptedAt" = ${at}
      WHERE id = 1 AND "lockedToken" = ${token}
    `;
  },
  async tryLease(token, now, until) {
    const count = await prisma.$executeRaw`
      UPDATE geography_did_state
      SET "lockedUntil" = ${until}, "lockedToken" = ${token}
      WHERE id = 1
        AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
    `;
    return count === 1;
  },
  async heartbeat(token, until) {
    const count = await prisma.$executeRaw`
      UPDATE geography_did_state
      SET "lockedUntil" = ${until}
      WHERE id = 1 AND "lockedToken" = ${token}
    `;
    return count === 1;
  },
  async release(token) {
    await prisma.$executeRaw`
      UPDATE geography_did_state
      SET "lockedUntil" = NULL, "lockedToken" = NULL
      WHERE id = 1 AND "lockedToken" = ${token}
    `;
  },
  async deleteGeneration(generation) {
    await prisma.geographyDidSource.deleteMany({ where: { generation } });
  },
  async deleteOtherGenerations(keep) {
    await prisma.geographyDidSource.deleteMany({ where: { generation: { not: keep } } });
  },
  async insertRows(generation, rows) {
    for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
      await prisma.geographyDidSource.createMany({
        data: rows.slice(index, index + INSERT_CHUNK).map((row) => ({
          generation,
          matchKey: row.matchKey,
          displayNumber: row.displayNumber,
          provider: row.provider,
          rowId: row.rowId,
        })),
      });
    }
  },
  async publish(expected, next, token, at) {
    const count = await prisma.$executeRaw`
      UPDATE geography_did_state
      SET generation = ${next}, "refreshedAt" = ${at}
      WHERE id = 1
        AND generation = ${expected}
        AND "lockedToken" = ${token}
    `;
    return count === 1;
  },
  async loadPage(page, pageSize, creds) {
    const result = await listDidPurchasedNumbers(
      page,
      pageSize,
      creds,
      DID_LIST_TIMEOUT_MS,
    );
    return { items: result.items, total: result.total, pageSize: result.pageSize };
  },
};

let inflight: Promise<void> | null = null;

export function resetGeographyDidRefreshForTests(): void {
  inflight = null;
}

/** Starts one walk when the snapshot is stale. Never throws to the caller. */
export function kickGeographyDidRefresh(): void {
  if (inflight) return;
  inflight = syncDidSnapshot(defaultDeps)
    .then((result) => {
      if (result.status === "published") {
        logger.info("number_geography.did_snapshot", { status: "published" });
        void import("@/modules/rtu/screen-publish")
          .then(({ requestRtuScreenPublish }) => requestRtuScreenPublish())
          .catch((error: unknown) => {
            logger.warn("rtu.screen.did_kick_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      } else if (result.status === "kept") {
        logger.warn("number_geography.did_snapshot", {
          status: "kept",
          code: result.code,
        });
      }
    })
    .catch((error: unknown) => {
      logger.warn("number_geography.did_snapshot", {
        status: "kept",
        code: resultCode(error),
      });
    })
    .finally(() => {
      inflight = null;
    });
}
