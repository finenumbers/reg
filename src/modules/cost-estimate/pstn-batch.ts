/**
 * Batch operator/geography from pstn_range_snapshot for cost-estimate digits.
 */

import { Prisma } from "@/generated/prisma/client";
import { chunkArray } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import {
  matchE164Sql,
  pstnHitLateral,
  PSTN_HIT_COLUMNS,
} from "@/modules/numbering-catalog/pstn-hit-sql";
import type { CostEstimatePstnFields } from "@/modules/cost-estimate/types";

const PSTN_BATCH = 1000;

type PstnBatchRow = {
  phone: string;
  pstn_operator: string | null;
  pstn_geography: string | null;
  pstn_hit_count: number;
};

export async function pstnSnapshotHasRows(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>(
    Prisma.sql`SELECT 1 AS ok FROM pstn_range_snapshot LIMIT 1`,
  );
  return rows.length > 0;
}

/**
 * Lookup unique digit strings. hits ≠ 1 → empty fields.
 * Keys of the map are the input digit strings.
 */
export async function pstnLookupBatch(
  digits: readonly string[],
): Promise<Map<string, CostEstimatePstnFields>> {
  const out = new Map<string, CostEstimatePstnFields>();
  const unique = [...new Set(digits.filter((d) => d.length > 0))];
  if (unique.length === 0) return out;

  for (const chunk of chunkArray(unique, PSTN_BATCH)) {
    const e164 = matchE164Sql(Prisma.sql`batch.raw`);
    const rows = await prisma.$queryRaw<PstnBatchRow[]>(Prisma.sql`
      SELECT
        batch.raw AS phone,
        ${PSTN_HIT_COLUMNS}
      FROM unnest(ARRAY[${Prisma.join(chunk)}]::text[]) AS batch(raw)
      ${pstnHitLateral(e164)}
    `);
    for (const row of rows) {
      if (row.pstn_hit_count === 1) {
        out.set(row.phone, {
          operator: row.pstn_operator?.trim() ?? "",
          geography: row.pstn_geography?.trim() ?? "",
        });
      } else {
        out.set(row.phone, { operator: "", geography: "" });
      }
    }
  }

  for (const digit of unique) {
    if (!out.has(digit)) out.set(digit, { operator: "", geography: "" });
  }
  return out;
}
