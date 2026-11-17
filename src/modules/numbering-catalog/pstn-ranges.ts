/**
 * One stored copy of the PSTN range dataset.
 * A later decorate pass fills operator and geography from it.
 * A failed read keeps the previous copy and does not clear those cells.
 */

import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import { prisma } from "@/lib/db";
import { pageStopped, readAllPagesTwice } from "@/modules/finenumbers/pages";
import { pstnTurn } from "@/modules/numbering-resource/turn";
import {
  EMPTY_NUMBERING_FILTERS,
  NUMBERING_EXPORT_PAGE_SIZE,
} from "@/modules/numbering-resource/filters";
import {
  listNumberingResource,
  summarizeNumberingResource,
} from "@/modules/numbering-resource/service";
import type { NumberingRow } from "@/modules/numbering-resource/types";

const ABC = /^\d{3}$/;
const LOCAL_MAX = 9_999_999;
const INSERT_CHUNK = 500;
const SWAP_TX = { maxWait: 10_000, timeout: 600_000 } as const;

function keepRange(row: NumberingRow): { kind: "keep" } | { kind: "skip" } {
  if (!ABC.test(row.abc)) return { kind: "skip" };
  if (!Number.isSafeInteger(row.rangeStart) || !Number.isSafeInteger(row.rangeEnd)) {
    return { kind: "skip" };
  }
  if (row.rangeStart < 0 || row.rangeEnd > LOCAL_MAX || row.rangeStart > row.rangeEnd) {
    return { kind: "skip" };
  }
  return { kind: "keep" };
}

async function storedLoadedAt(): Promise<string> {
  const rows = await prisma.$queryRaw<{ loaded_at: string }[]>`
    SELECT loaded_at FROM pstn_range_state WHERE id = 1
  `;
  return rows[0]?.loaded_at ?? "";
}

async function insertLoad(rows: readonly NumberingRow[]): Promise<void> {
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK);
    const values = chunk.map(
      (row) =>
        Prisma.sql`(
          ${row.abc},
          ${row.rangeStart},
          ${row.rangeEnd},
          ${row.operator.trim()},
          ${row.garTerritory.trim()}
        )`,
    );
    await prisma.$executeRaw`
      INSERT INTO pstn_range_load (abc, range_start, range_end, operator, gar_territory)
      VALUES ${Prisma.join(values)}
    `;
  }
}

async function swap(loadedAt: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`TRUNCATE pstn_range_snapshot`;
    await tx.$executeRaw`
      INSERT INTO pstn_range_snapshot (abc, range_start, range_end, operator, gar_territory)
      SELECT abc, range_start, range_end, operator, gar_territory
      FROM pstn_range_load
    `;
    await tx.$executeRaw`ANALYZE pstn_range_snapshot`;
    await tx.$executeRaw`TRUNCATE pstn_range_load`;
    const state = await tx.$executeRaw`
      UPDATE pstn_range_state SET loaded_at = ${loadedAt} WHERE id = 1
    `;
    const epoch = await tx.$executeRaw`
      UPDATE numbering_catalog_state
      SET pstn_range_epoch = pstn_range_epoch + 1
      WHERE id = 1
    `;
    if (state !== 1 || epoch !== 1) throw new Error("Не удалось сохранить диапазоны.");
  }, SWAP_TX);
}

export type SnapshotRefresh = "ready" | "yielded";

async function refresh(stop?: () => Promise<boolean>): Promise<SnapshotRefresh> {
  const summary = await pstnTurn(() => summarizeNumberingResource(EMPTY_NUMBERING_FILTERS));
  const loadedAt = summary.loadedAt ?? "";
  if (!loadedAt) return "ready";
  if ((await storedLoadedAt()) === loadedAt) return "ready";
  const read = await readAllPagesTwice({
    page: (cursor) =>
      pstnTurn(() =>
        listNumberingResource({
          cursor,
          pageSize: NUMBERING_EXPORT_PAGE_SIZE,
          filters: EMPTY_NUMBERING_FILTERS,
        }),
      ),
    accept: keepRange,
    stop,
  });
  if (pageStopped(read)) return "yielded";
  if (!read.ok) return "ready";
  const again = await pstnTurn(() => summarizeNumberingResource(EMPTY_NUMBERING_FILTERS));
  if ((again.loadedAt ?? "") !== loadedAt) return "ready";
  await prisma.$executeRaw`TRUNCATE pstn_range_load`;
  try {
    await insertLoad(read.items);
    await swap(loadedAt);
  } catch (error) {
    await prisma.$executeRaw`TRUNCATE pstn_range_load`.catch(() => undefined);
    throw error;
  }
  return "ready";
}

/** Compare loadedAt first. The same dataset is not downloaded again. A stop leaves it. */
export async function refreshPstnRangeSnapshot(
  stop?: () => Promise<boolean>,
): Promise<SnapshotRefresh> {
  try {
    return await refresh(stop);
  } catch (error) {
    const code = error instanceof NumberingClientError ? error.code : "failed";
    logger.warn("pstn.range_snapshot.failed", { error: code });
    return "ready";
  }
}
