/**
 * Cap one OPRS read. The limit is local to the transaction, so the pool
 * connection is not left with a short timeout.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const STATEMENT_TIMEOUT = "60s";

export async function withOprsTimeout<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
      return run(tx);
    },
    {
      maxWait: 5_000,
      timeout: 70_000,
      ...(isolationLevel ? { isolationLevel } : {}),
    },
  );
}
