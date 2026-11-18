/**
 * Draft tariff fill and the catalog copy. The copy does not call tariff functions.
 * Both catalogs are Aurora Telecom rows only.
 */

import { Prisma } from "@/generated/prisma/client";
import { fillStageSplitSql } from "@/modules/numbering-catalog/decorate";
import type { AuroraRow } from "@/modules/aurora/parse";

export const AURORA_PROVIDER = "Aurora Telecom";
export const SPLIT_BATCH = 2000;

export const DELETE_AURORA_FREE_SQL = `DELETE FROM free_numbers WHERE provider = 'Aurora Telecom'`;
export const DELETE_AURORA_PURCHASED_SQL = `DELETE FROM purchased_numbers WHERE provider = 'Aurora Telecom'`;

export const STAGED_COUNT_SQL = `
  SELECT catalog, count(*)::int AS count
  FROM aurora_sync_stage
  WHERE run_id = $1 AND ready = true
  GROUP BY catalog
`;

export const FREE_COPY_SQL = `
  INSERT INTO free_numbers (
    id, provider, abc, "number", city, region,
    purchase, subscription, mask, "maskType", sale, premium,
    operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Aurora Telecom',
    abc,
    "number",
    city,
    region,
    incoming_purchase,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    e164
  FROM aurora_sync_stage
  WHERE run_id = $1 AND catalog = 'free' AND ready = true
`;

export const PURCHASED_COPY_SQL = `
  INSERT INTO purchased_numbers (
    id, provider, abc, "number", city, region, client,
    purchase, subscription, mask, "maskType", sale, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Aurora Telecom',
    abc,
    "number",
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
    '',
    e164
  FROM aurora_sync_stage
  WHERE run_id = $1 AND catalog = 'purchased' AND ready = true
`;

export function decidePublish(input: {
  held: boolean;
  stagedFree: number;
  insertedFree: number;
  stagedPurchased: number;
  insertedPurchased: number;
}): "commit" | "rollback" {
  if (!input.held) return "rollback";
  if (input.stagedFree !== input.insertedFree) return "rollback";
  if (input.stagedPurchased !== input.insertedPurchased) return "rollback";
  return "commit";
}

export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  return fillStageSplitSql("aurora_sync_stage", runId, limit);
}

export function stageFreeSql(runId: string, rows: readonly AuroraRow[]): Prisma.Sql {
  const values = rows.map(
    (row) => Prisma.sql`(${runId}, 'free', ${row.e164}, ${row.incomingPurchase})`,
  );
  return Prisma.sql`
    INSERT INTO aurora_sync_stage (
      run_id, catalog, e164, incoming_purchase
    )
    VALUES ${Prisma.join(values)}
  `;
}
