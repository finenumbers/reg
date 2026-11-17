/**
 * Phone numbers already on the switch. One repeatable read, before PSTN.
 * Only the endpoint number is selected. The row JSON holds passwords.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { PHONES_NOT_READY } from "@/modules/finenumbers/walk";
import { pstnCacheKey } from "@/modules/rtu/sql";

export async function loadPhoneKeys(): Promise<Set<string>> {
  return prisma.$transaction(
    async (tx) => {
      const state = await tx.phoneImportState.findUnique({
        where: { id: 1 },
        select: { lastSyncedAt: true },
      });
      if (!state?.lastSyncedAt) throw new Error(PHONES_NOT_READY);
      const rows = await tx.$queryRaw<{ endpointNumber: string }[]>`
        SELECT "endpointNumber"
        FROM phone_endpoints
        WHERE "endpointNumber" IS NOT NULL
          AND btrim("endpointNumber") <> ''
      `;
      const keys = new Set<string>();
      for (const row of rows) {
        const key = pstnCacheKey(row.endpointNumber);
        if (key) keys.add(key);
      }
      return keys;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 15_000,
      timeout: 120_000,
    },
  );
}
