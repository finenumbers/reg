/**
 * Replace tariff_rates with one uploaded snapshot.
 * An invalid file must never call this: an empty list is not a wipe.
 */

import { prisma } from "@/lib/db";
import type { TariffParsedRow } from "@/modules/tariffs/parse-xlsx";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
const CREATE_BATCH = 500;

export type ApplyTariffsResult = {
  rowCount: number;
  loadedAt: Date;
};

export async function applyTariffSnapshot(
  rows: TariffParsedRow[],
  filename: string,
  loadedAt: Date = new Date(),
): Promise<ApplyTariffsResult> {
  await prisma.$transaction(async (tx) => {
    await tx.tariffRate.deleteMany({});
    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      const slice = rows.slice(i, i + CREATE_BATCH);
      await tx.tariffRate.createMany({
        data: slice.map((row) => ({
          sortIndex: row.sortIndex,
          direction: row.direction,
          abc: row.abc,
          price: row.price,
        })),
      });
    }
    await tx.tariffImportState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        rowCount: rows.length,
        filename,
        loadedAt,
        rateGeneration: 1,
        ratedGeneration: 0,
      },
      update: {
        rowCount: rows.length,
        filename,
        loadedAt,
        rateGeneration: { increment: 1 },
      },
    });
  }, APPLY_TX);

  void import("@/modules/traffic/tariff-rate/enqueue")
    .then(({ requestCdrTariffRate }) => requestCdrTariffRate("schedule"))
    .catch(() => undefined);

  return { rowCount: rows.length, loadedAt };
}
