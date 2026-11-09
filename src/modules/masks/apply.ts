/**
 * Replace number_masks with one uploaded snapshot.
 * An invalid file must never call this: an empty list is not a wipe.
 * The lock is not the phone-catalog lock.
 */

import { prisma } from "@/lib/db";
import type { MaskParsedRow } from "@/modules/masks/parse-xlsx";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
const CREATE_BATCH = 500;
const MASK_CATALOG_LOCK_SQL = "SELECT pg_advisory_xact_lock(4815162342002::bigint)";

export type ApplyMasksResult = {
  rowCount: number;
  loadedAt: Date;
};

export async function applyMaskSnapshot(
  rows: MaskParsedRow[],
  filename: string,
  loadedAt: Date = new Date(),
): Promise<ApplyMasksResult> {
  if (rows.length === 0) {
    throw new Error("Пустой снимок масок не записывается");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(MASK_CATALOG_LOCK_SQL);
    await tx.numberMask.deleteMany({});
    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      const slice = rows.slice(i, i + CREATE_BATCH);
      await tx.numberMask.createMany({
        data: slice.map((row) => ({
          sortIndex: row.sortIndex,
          digitLength: row.digitLength,
          category: row.category,
          abc: row.abc,
          mask: row.mask,
          maskType: row.maskType,
          premium: row.premium,
          purchase: row.purchase,
        })),
      });
    }
    await tx.numberMaskImportState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        rowCount: rows.length,
        filename,
        loadedAt,
      },
      update: {
        rowCount: rows.length,
        filename,
        loadedAt,
      },
    });
  }, APPLY_TX);

  return { rowCount: rows.length, loadedAt };
}
