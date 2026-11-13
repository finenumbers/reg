/**
 * Replace marking_rows with one uploaded snapshot.
 * An invalid file must never call this: an empty list is not a wipe.
 * The lock is not the phone-catalog lock or the mask-catalog lock.
 */

import { prisma } from "@/lib/db";
import { isTransientPrismaError } from "@/lib/prisma-transient";
import { MARKING_PARSE_ERROR, type MarkingParsedRow } from "@/modules/marking/parse-xlsx";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
const CREATE_BATCH = 500;
const MARKING_CATALOG_LOCK_SQL = "SELECT pg_advisory_xact_lock(4815162342003::bigint)";
const BUSY = "Идёт загрузка маркировки. Повторите, когда она закончится.";
const DUPLICATE = "Повтор номера. Снимок не изменён.";

export type ApplyMarkingResult = {
  rowCount: number;
  loadedAt: Date;
};

export type MarkingApplyHttpError = {
  status: 400 | 409;
  error: string;
  details: string[];
};

export function markingApplyHttpError(error: unknown): MarkingApplyHttpError | null {
  if (isUniqueViolation(error)) {
    return { status: 400, error: MARKING_PARSE_ERROR, details: [DUPLICATE] };
  }
  if (isTransientPrismaError(error)) {
    return { status: 409, error: BUSY, details: [BUSY] };
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function applyMarkingSnapshot(
  rows: MarkingParsedRow[],
  filename: string,
  loadedAt: Date = new Date(),
): Promise<ApplyMarkingResult> {
  if (rows.length === 0) {
    throw new Error("Пустой снимок маркировки не записывается");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(MARKING_CATALOG_LOCK_SQL);
    await tx.markingRow.deleteMany({});
    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      const slice = rows.slice(i, i + CREATE_BATCH);
      await tx.markingRow.createMany({
        data: slice.map((row) => ({
          sortIndex: row.sortIndex,
          client: row.client,
          phoneNumber: row.phoneNumber,
          labelMts: row.labelMts,
          labelMegafon: row.labelMegafon,
          labelBeeline: row.labelBeeline,
          labelT2: row.labelT2,
          mavMts: row.mavMts,
          mavMegafon: row.mavMegafon,
          mavBeeline: row.mavBeeline,
          mavT2: row.mavT2,
        })),
      });
    }
    await tx.markingImportState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        rowCount: rows.length,
        filename,
        loadedAt,
        generation: 1,
      },
      update: {
        rowCount: rows.length,
        filename,
        loadedAt,
        generation: { increment: 1 },
      },
    });
  }, APPLY_TX);

  return { rowCount: rows.length, loadedAt };
}
