/**
 * Draft tariff fill and the catalog copy. The provider is a SQL literal.
 * Both catalogs replace only Finenumbers rows.
 */

import { Prisma } from "@/generated/prisma/client";
import { fillStageSplitSql } from "@/modules/numbering-catalog/decorate";
import type { ExpandedNumber } from "@/modules/finenumbers/expand";

export const FINENUMBERS_PROVIDER_SQL = "Finenumbers";
export const SPLIT_BATCH = 2000;
export const STAGE_CHUNK = 500;
export const COPY_CHUNK = 5000;

export const STAGED_COUNT_SQL = `
  SELECT catalog, count(*)::int AS count
  FROM finenumbers_sync_stage
  WHERE run_id = $1 AND ready = true
  GROUP BY catalog
`;

export const OVERLAP_SQL = `
  SELECT count(*)::int AS count
  FROM finenumbers_sync_stage AS free
  INNER JOIN finenumbers_sync_stage AS bought
    ON bought.run_id = free.run_id
   AND bought.catalog = 'purchased'
   AND bought.e164 = free.e164
  WHERE free.run_id = $1
    AND free.catalog = 'free'
`;

export const DELETE_FREE_CHUNK_SQL = `
  DELETE FROM free_numbers
  WHERE id IN (
    SELECT id FROM free_numbers
    WHERE provider = 'Finenumbers'
    ORDER BY id
    LIMIT ${COPY_CHUNK}
  )
`;

export const DELETE_PURCHASED_CHUNK_SQL = `
  DELETE FROM purchased_numbers
  WHERE id IN (
    SELECT id FROM purchased_numbers
    WHERE provider = 'Finenumbers'
    ORDER BY id
    LIMIT ${COPY_CHUNK}
  )
`;

export const FREE_COPY_SQL = `
  WITH picked AS (
    SELECT abc, "number", city, region, e164
    FROM finenumbers_sync_stage
    WHERE run_id = $1
      AND catalog = 'free'
      AND ready = true
      AND e164 > $2
    ORDER BY e164
    LIMIT ${COPY_CHUNK}
  ),
  inserted AS (
    INSERT INTO free_numbers (
      id, provider, abc, "number", category, city, region,
      purchase, subscription, mask, "maskType", sale, premium,
      operator, geography, e164
    )
    SELECT
      gen_random_uuid()::text,
      'Finenumbers',
      abc,
      "number",
      '',
      city,
      region,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      e164
    FROM picked
    RETURNING e164
  )
  SELECT COALESCE(max(e164), '') AS last, count(*)::int AS count FROM inserted
`;

export const PURCHASED_COPY_SQL = `
  WITH picked AS (
    SELECT abc, "number", city, region, e164
    FROM finenumbers_sync_stage
    WHERE run_id = $1
      AND catalog = 'purchased'
      AND ready = true
      AND e164 > $2
    ORDER BY e164
    LIMIT ${COPY_CHUNK}
  ),
  inserted AS (
    INSERT INTO purchased_numbers (
      id, provider, abc, "number", category, city, region, client,
      mask, "maskType", purchase, premium, operator, geography, e164
    )
    SELECT
      gen_random_uuid()::text,
      'Finenumbers',
      abc,
      "number",
      '',
      city,
      region,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      e164
    FROM picked
    RETURNING e164
  )
  SELECT COALESCE(max(e164), '') AS last, count(*)::int AS count FROM inserted
`;

export function decidePublish(input: {
  held: boolean;
  expected: number;
  overlap: number;
  stagedFree: number;
  insertedFree: number;
  stagedPurchased: number;
  insertedPurchased: number;
}): "commit" | "rollback" {
  if (!input.held) return "rollback";
  if (input.overlap !== 0) return "rollback";
  if (input.stagedFree !== input.insertedFree) return "rollback";
  if (input.stagedPurchased !== input.insertedPurchased) return "rollback";
  if (input.stagedFree + input.stagedPurchased !== input.expected) return "rollback";
  return "commit";
}

export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  return fillStageSplitSql("finenumbers_sync_stage", runId, limit);
}

export function existingSql(runId: string, dids: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT e164
    FROM finenumbers_sync_stage
    WHERE run_id = ${runId}
      AND e164 IN (${Prisma.join(dids)})
  `;
}

export function stageSql(
  runId: string,
  catalog: "free" | "purchased",
  rows: readonly ExpandedNumber[],
): Prisma.Sql {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${runId}, ${catalog}, ${row.e164}, ${row.operator}, ${row.geography})`,
  );
  return Prisma.sql`
    INSERT INTO finenumbers_sync_stage (
      run_id, catalog, e164, operator, geography
    )
    VALUES ${Prisma.join(values)}
  `;
}
