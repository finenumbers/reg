/**
 * Draft tariff fill and the catalog copy. The copy does not call tariff functions.
 * Both catalogs are Voximplant rows only.
 */

import { Prisma } from "@/generated/prisma/client";
import { fillStageSplitSql } from "@/modules/numbering-catalog/decorate";
import type { FreeRow } from "@/modules/voximplant/parse";

export const VOXIMPLANT_PROVIDER = "Voximplant";
export const SPLIT_BATCH = 2000;

export const DELETE_VOXIMPLANT_FREE_SQL = `DELETE FROM free_numbers WHERE provider = 'Voximplant'`;
export const DELETE_VOXIMPLANT_PURCHASED_SQL = `DELETE FROM purchased_numbers WHERE provider = 'Voximplant'`;

export const STAGED_COUNT_SQL = `
  SELECT count(*)::int AS count
  FROM voximplant_sync_stage
  WHERE run_id = $1 AND catalog = $2 AND ready = true
`;

export const FREE_COPY_SQL = `
  INSERT INTO free_numbers (
    id, provider, abc, "number", city, region,
    purchase, subscription, mask, "maskType", sale, premium,
    operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Voximplant',
    abc,
    "number",
    city,
    region,
    incoming_purchase,
    incoming_period,
    '',
    '',
    '',
    '',
    '',
    '',
    e164
  FROM voximplant_sync_stage
  WHERE run_id = $1 AND catalog = 'free' AND ready = true
`;

export const PURCHASED_COPY_SQL = `
  INSERT INTO purchased_numbers (
    id, provider, abc, "number", city, region, client,
    purchase, subscription, mask, "maskType", sale, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Voximplant',
    abc,
    "number",
    city,
    region,
    '',
    incoming_purchase,
    incoming_period,
    '',
    '',
    '',
    '',
    '',
    '',
    e164
  FROM voximplant_sync_stage
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

export function dropOverlapSql(runId: string): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM voximplant_sync_stage AS free
    USING voximplant_sync_stage AS bought
    WHERE free.run_id = ${runId}
      AND free.catalog = 'free'
      AND bought.run_id = free.run_id
      AND bought.catalog = 'purchased'
      AND bought.e164 = free.e164
  `;
}

export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  return fillStageSplitSql("voximplant_sync_stage", runId, limit);
}

export function dropPurchasedSql(runId: string): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM voximplant_sync_stage
    WHERE run_id = ${runId} AND catalog = 'purchased'
  `;
}

export function existingSql(
  runId: string,
  catalog: "free" | "purchased",
  dids: readonly string[],
): Prisma.Sql {
  return Prisma.sql`
    SELECT e164
    FROM voximplant_sync_stage
    WHERE run_id = ${runId}
      AND catalog = ${catalog}
      AND e164 IN (${Prisma.join(dids)})
  `;
}

export function stageFreeSql(runId: string, rows: readonly FreeRow[]): Prisma.Sql {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${runId}, 'free', ${row.e164}, ${row.incomingPurchase}, ${row.incomingPeriod})`,
  );
  return Prisma.sql`
    INSERT INTO voximplant_sync_stage (
      run_id, catalog, e164, incoming_purchase, incoming_period
    )
    VALUES ${Prisma.join(values)}
  `;
}

export function stagePurchasedSql(runId: string, rows: readonly FreeRow[]): Prisma.Sql {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${runId}, 'purchased', ${row.e164}, ${row.incomingPurchase}, ${row.incomingPeriod})`,
  );
  return Prisma.sql`
    INSERT INTO voximplant_sync_stage (
      run_id, catalog, e164, incoming_purchase, incoming_period
    )
    VALUES ${Prisma.join(values)}
  `;
}
