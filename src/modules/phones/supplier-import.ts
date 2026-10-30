/**
 * Write supplier values onto phone_endpoints by number.
 * The XLSX is parsed before the catalog lock. A file that matches nothing
 * does not open a transaction.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  indexSupplierCatalog,
  matchSupplierNumber,
} from "@/modules/phones/supplier-match";
import {
  PHONE_CATALOG_LOCK_SQL,
  SUPPLIER_FIELD,
  readSupplier,
} from "@/modules/phones/supplier";
import type { SupplierFileRow } from "@/modules/phones/supplier-xlsx";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;

export type SupplierImportResult = {
  updated: number;
  cleared: number;
  unmatched: number;
};

function cloneData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return { ...(data as Record<string, unknown>) };
}

export async function importPhoneSuppliers(
  fileRows: readonly SupplierFileRow[],
): Promise<SupplierImportResult> {
  const preview = await prisma.phoneEndpoint.findMany({
    select: { id: true, endpointNumber: true },
  });
  const previewIndex = indexSupplierCatalog(
    preview.flatMap((row) =>
      row.endpointNumber
        ? [{ id: row.id, endpointNumber: row.endpointNumber }]
        : [],
    ),
  );
  const previewHits = fileRows.some(
    (row) => matchSupplierNumber(row.number, previewIndex).length > 0,
  );
  if (!previewHits) {
    return { updated: 0, cleared: 0, unmatched: fileRows.length };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(PHONE_CATALOG_LOCK_SQL);
    const endpoints = await tx.phoneEndpoint.findMany({
      select: { id: true, endpointNumber: true, data: true },
    });
    const index = indexSupplierCatalog(
      endpoints.flatMap((row) =>
        row.endpointNumber
          ? [{ id: row.id, endpointNumber: row.endpointNumber }]
          : [],
      ),
    );
    const byId = new Map(endpoints.map((row) => [row.id, row]));
    const pending = new Map<string, string>();
    let unmatched = 0;
    for (const row of fileRows) {
      const hits = matchSupplierNumber(row.number, index);
      if (hits.length === 0) {
        unmatched += 1;
        continue;
      }
      for (const hit of hits) pending.set(hit.id, row.supplier);
    }

    let updated = 0;
    let cleared = 0;
    for (const [id, supplier] of pending) {
      const row = byId.get(id);
      if (!row) continue;
      const next = cloneData(row.data);
      if (supplier) next[SUPPLIER_FIELD] = supplier;
      else delete next[SUPPLIER_FIELD];
      const previous = readSupplier(row.data);
      if (previous === supplier) {
        if (supplier) updated += 1;
        continue;
      }
      await tx.phoneEndpoint.update({
        where: { id },
        data: { data: next as Prisma.InputJsonValue },
      });
      if (supplier) updated += 1;
      else cleared += 1;
    }
    return { updated, cleared, unmatched };
  }, APPLY_TX);
}
