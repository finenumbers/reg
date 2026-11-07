/**
 * Write supplier and category onto phone_endpoints by number.
 * The XLSX is parsed before the catalog lock. A file that matches nothing
 * does not open a transaction. One row writes both keys together.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { applyPhoneAnnotation } from "@/modules/phones/annotation";
import {
  indexSupplierCatalog,
  matchSupplierNumber,
} from "@/modules/phones/supplier-match";
import { PHONE_CATALOG_LOCK_SQL } from "@/modules/phones/supplier";
import { patchRtuScreenSuppliers } from "@/modules/rtu/screen-publish";
import type { SupplierFileRow } from "@/modules/phones/supplier-xlsx";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;

export type SupplierImportResult = {
  updated: number;
  cleared: number;
  categoryUpdated: number;
  categoryCleared: number;
  unmatched: number;
};

export async function importPhoneSuppliers(
  fileRows: readonly SupplierFileRow[],
): Promise<SupplierImportResult> {
  const preview = await prisma.phoneEndpoint.findMany({
    select: { id: true, endpointNumber: true },
  });
  const previewIndex = indexSupplierCatalog(
    preview.flatMap((row) =>
      row.endpointNumber ? [{ id: row.id, endpointNumber: row.endpointNumber }] : [],
    ),
  );
  const previewHits = fileRows.some(
    (row) => matchSupplierNumber(row.number, previewIndex).length > 0,
  );
  if (!previewHits) {
    return {
      updated: 0,
      cleared: 0,
      categoryUpdated: 0,
      categoryCleared: 0,
      unmatched: fileRows.length,
    };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(PHONE_CATALOG_LOCK_SQL);
    const endpoints = await tx.phoneEndpoint.findMany({
      select: { id: true, endpointNumber: true, data: true },
    });
    const index = indexSupplierCatalog(
      endpoints.flatMap((row) =>
        row.endpointNumber ? [{ id: row.id, endpointNumber: row.endpointNumber }] : [],
      ),
    );
    const byId = new Map(endpoints.map((row) => [row.id, row]));
    const pending = new Map<string, { supplier: string; category: string }>();
    let unmatched = 0;
    for (const row of fileRows) {
      const hits = matchSupplierNumber(row.number, index);
      if (hits.length === 0) {
        unmatched += 1;
        continue;
      }
      for (const hit of hits) {
        pending.set(hit.id, { supplier: row.supplier, category: row.category });
      }
    }

    let updated = 0;
    let cleared = 0;
    let categoryUpdated = 0;
    let categoryCleared = 0;
    const screenRows: { id: string; supplier: string; category: string }[] = [];
    for (const [id, nextValues] of pending) {
      const row = byId.get(id);
      if (!row) continue;
      const patch = applyPhoneAnnotation(row.data, nextValues);
      if (patch.supplier === "updated") updated += 1;
      else if (patch.supplier === "cleared") cleared += 1;
      if (patch.category === "updated") categoryUpdated += 1;
      else if (patch.category === "cleared") categoryCleared += 1;
      if (!patch.write) continue;
      await tx.phoneEndpoint.update({
        where: { id },
        data: { data: patch.data as Prisma.InputJsonValue },
      });
      screenRows.push({
        id,
        supplier: nextValues.supplier.trim(),
        category: nextValues.category.trim(),
      });
    }
    await patchRtuScreenSuppliers(tx, screenRows);
    return { updated, cleared, categoryUpdated, categoryCleared, unmatched };
  }, APPLY_TX);
}
