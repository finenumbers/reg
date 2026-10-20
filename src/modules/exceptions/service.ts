/**
 * Digit ABC codes that send an uncovered B-number to «Ошибка» / «Проверить».
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  DIAL_EXCEPTION_ABC_ERROR,
  parseDialExceptionAbc,
} from "@/modules/exceptions/abc";
import { requestCdrTariffRate } from "@/modules/traffic/tariff-rate/enqueue";

export type DialExceptionItem = {
  abc: string;
};

export type DialExceptionWriteResult =
  { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

function sortExceptions(items: DialExceptionItem[]): DialExceptionItem[] {
  return items.sort(
    (left, right) =>
      right.abc.length - left.abc.length ||
      (left.abc < right.abc ? -1 : left.abc > right.abc ? 1 : 0),
  );
}

/** Live list for classification. Empty means no digit exception, not the seed. */
export async function loadDialExceptions(): Promise<string[]> {
  const rows = await prisma.dialException.findMany({ select: { abc: true } });
  return rows.map((row) => row.abc);
}

export async function listDialExceptions(): Promise<DialExceptionItem[]> {
  const rows = await prisma.dialException.findMany({ select: { abc: true } });
  return sortExceptions(rows);
}

async function bumpTariffGeneration(tx: Prisma.TransactionClient): Promise<void> {
  await tx.tariffImportState.upsert({
    where: { id: 1 },
    create: { id: 1, rateGeneration: 1, ratedGeneration: 0 },
    update: { rateGeneration: { increment: 1 } },
  });
}

export async function addDialException(
  raw: unknown,
  actorUserId?: string,
): Promise<DialExceptionWriteResult> {
  const abc = parseDialExceptionAbc(raw);
  if (!abc) return { ok: false, status: 400, error: DIAL_EXCEPTION_ABC_ERROR };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.dialException.create({ data: { abc } });
      await bumpTariffGeneration(tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 409, error: "Такой ABC уже есть" };
    }
    throw error;
  }

  await requestCdrTariffRate("manual", actorUserId);
  return { ok: true };
}

export async function deleteDialException(
  raw: unknown,
  actorUserId?: string,
): Promise<DialExceptionWriteResult> {
  const abc = parseDialExceptionAbc(raw);
  if (!abc) return { ok: false, status: 400, error: DIAL_EXCEPTION_ABC_ERROR };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.dialException.delete({ where: { abc } });
      await bumpTariffGeneration(tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, status: 404, error: "Такого ABC нет" };
    }
    throw error;
  }

  await requestCdrTariffRate("manual", actorUserId);
  return { ok: true };
}
