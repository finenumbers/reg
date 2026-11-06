/**
 * Endpoints whose «Статус» is «Заблокировано».
 * A hit is the trimmed catalog string, or the same 10-digit PSTN key.
 * A longer digit string is not folded, and a short number matches only exactly.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pstnCacheKey } from "@/modules/number-geography/sql";
import { STATUS_BLOCKED } from "@/modules/phones/types";

export type BlockedNumberIndex = {
  exact: ReadonlySet<string>;
  pstn: ReadonlySet<string>;
};

type CacheEntry = {
  stamp: string;
  index: BlockedNumberIndex;
};

let cached: CacheEntry | null = null;

export function emptyBlockedNumberIndex(): BlockedNumberIndex {
  return { exact: new Set(), pstn: new Set() };
}

export function resetBlockedNumberCacheForTests(): void {
  cached = null;
}

export function buildBlockedNumberIndex(numbers: readonly string[]): BlockedNumberIndex {
  const exact = new Set<string>();
  const pstn = new Set<string>();
  for (const raw of numbers) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    exact.add(trimmed);
    const key = pstnCacheKey(trimmed);
    if (key) pstn.add(key);
  }
  return { exact, pstn };
}

export function numberIsBlocked(
  index: BlockedNumberIndex,
  raw: string | null | undefined,
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  if (index.exact.has(trimmed)) return true;
  const key = pstnCacheKey(trimmed);
  return key != null && index.pstn.has(key);
}

export function anyNumberBlocked(
  index: BlockedNumberIndex,
  values: readonly (string | null | undefined)[],
): boolean {
  for (const value of values) {
    if (numberIsBlocked(index, value)) return true;
  }
  return false;
}

/**
 * One catalog read per phone sync per process.
 * A failed read is not cached and does not throw: the list still opens, uncolored.
 */
export async function loadBlockedNumbers(): Promise<BlockedNumberIndex> {
  try {
    const state = await prisma.phoneImportState.findUnique({
      where: { id: 1 },
      select: { lastSyncedAt: true },
    });
    const stamp = state?.lastSyncedAt?.toISOString() ?? "";
    if (cached?.stamp === stamp) return cached.index;
    const rows = await prisma.$queryRaw<Array<{ number: string | null }>>(Prisma.sql`
      SELECT btrim("endpointNumber") AS number
      FROM phone_endpoints
      WHERE btrim(COALESCE(data->>'Статус', '')) = ${STATUS_BLOCKED}
        AND "endpointNumber" IS NOT NULL
        AND btrim("endpointNumber") <> ''
    `);
    const index = buildBlockedNumberIndex(rows.map((row) => row.number ?? ""));
    cached = { stamp, index };
    return index;
  } catch (error) {
    logger.warn("blocked number catalog unread", {
      name: error instanceof Error ? error.name : "Error",
    });
    return emptyBlockedNumberIndex();
  }
}
