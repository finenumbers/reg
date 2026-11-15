/**
 * Draft tariff fill and the catalog copy. The copy does not call tariff functions.
 * Both catalogs are Runexis rows only.
 */

import { Prisma } from "@/generated/prisma/client";
import type { FreeDraft } from "@/modules/runexis/parse";
import { cityLabelSql } from "@/modules/rtu/sql";

export const RUNEXIS_PROVIDER = "Runexis";
export const SPLIT_BATCH = 2000;

export const DELETE_RUNEXIS_FREE_SQL = `DELETE FROM free_numbers WHERE provider = 'Runexis'`;
export const DELETE_RUNEXIS_PURCHASED_SQL = `DELETE FROM purchased_numbers WHERE provider = 'Runexis'`;

export const STAGED_COUNT_SQL = `
  SELECT catalog, count(*)::int AS count
  FROM runexis_sync_stage
  WHERE run_id = $1 AND ready = true
  GROUP BY catalog
`;

export const FREE_COPY_SQL = `
  INSERT INTO free_numbers (
    id, provider, abc, "number", category, city, region,
    mask, "maskType", "incomingPurchase", "incomingPeriod",
    purchase, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Runexis',
    abc,
    "number",
    '',
    city,
    region,
    '',
    '',
    incoming_purchase,
    incoming_period,
    '',
    '',
    '',
    '',
    e164
  FROM runexis_sync_stage
  WHERE run_id = $1 AND catalog = 'free' AND ready = true
`;

export const PURCHASED_COPY_SQL = `
  INSERT INTO purchased_numbers (
    id, provider, abc, "number", category, city, region, client,
    mask, "maskType", purchase, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'Runexis',
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
  FROM runexis_sync_stage
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
    DELETE FROM runexis_sync_stage AS free
    USING runexis_sync_stage AS bought
    WHERE free.run_id = ${runId}
      AND free.catalog = 'free'
      AND bought.run_id = free.run_id
      AND bought.catalog = 'purchased'
      AND bought.e164 = free.e164
  `;
}

export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH todo AS (
      SELECT catalog, e164
      FROM runexis_sync_stage
      WHERE run_id = ${runId} AND ready = false
      ORDER BY catalog, e164
      LIMIT ${limit}
    ),
    computed AS (
      SELECT
        todo.catalog,
        todo.e164,
        COALESCE(split.abc, '') AS abc,
        COALESCE(split.telephone, '') AS telephone,
        ${city} AS city,
        COALESCE(btrim(geo.region), '') AS region
      FROM todo
      LEFT JOIN LATERAL cdr_tariff_geo(todo.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, todo.e164) AS split ON TRUE
    )
    UPDATE runexis_sync_stage AS stage
    SET
      abc = computed.abc,
      "number" = computed.telephone,
      city = computed.city,
      region = computed.region,
      ready = true
    FROM computed
    WHERE stage.run_id = ${runId}
      AND stage.catalog = computed.catalog
      AND stage.e164 = computed.e164
  `;
}

export function stageFreeSql(runId: string, rows: readonly FreeDraft[]): Prisma.Sql {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${runId}, 'free', ${row.e164}, ${row.incomingPurchase}, ${row.incomingPeriod})`,
  );
  return Prisma.sql`
    INSERT INTO runexis_sync_stage (
      run_id, catalog, e164, incoming_purchase, incoming_period
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (run_id, catalog, e164) DO NOTHING
  `;
}

export function stagePurchasedSql(runId: string, dids: readonly string[]): Prisma.Sql {
  const values = dids.map((e164) => Prisma.sql`(${runId}, 'purchased', ${e164})`);
  return Prisma.sql`
    INSERT INTO runexis_sync_stage (run_id, catalog, e164)
    VALUES ${Prisma.join(values)}
  `;
}
