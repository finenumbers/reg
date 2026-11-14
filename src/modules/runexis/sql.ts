/**
 * Draft tariff fill and the free-number copy. The copy does not call tariff functions.
 * purchased_numbers is not in these statements.
 */

import { Prisma } from "@/generated/prisma/client";
import { cityLabelSql } from "@/modules/rtu/sql";

export const RUNEXIS_PROVIDER = "Runexis";
export const SPLIT_BATCH = 2000;

export const DELETE_RUNEXIS_FREE_SQL = `DELETE FROM free_numbers WHERE provider = 'Runexis'`;

export const STAGED_COUNT_SQL = `
  SELECT count(*)::int AS count
  FROM runexis_sync_stage
  WHERE run_id = $1 AND ready = true
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
    '',
    '',
    '',
    '',
    '',
    '',
    e164
  FROM runexis_sync_stage
  WHERE run_id = $1 AND ready = true
`;

export function decidePublish(input: {
  held: boolean;
  staged: number;
  inserted: number;
}): "commit" | "rollback" {
  if (!input.held) return "rollback";
  if (input.staged !== input.inserted) return "rollback";
  return "commit";
}

export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH todo AS (
      SELECT e164
      FROM runexis_sync_stage
      WHERE run_id = ${runId} AND ready = false
      ORDER BY e164
      LIMIT ${limit}
    ),
    computed AS (
      SELECT
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
      AND stage.e164 = computed.e164
  `;
}

export function stageInsertSql(runId: string, dids: readonly string[]): Prisma.Sql {
  const rows = dids.map((e164) => Prisma.sql`(${runId}, ${e164})`);
  return Prisma.sql`
    INSERT INTO runexis_sync_stage (run_id, e164)
    VALUES ${Prisma.join(rows)}
  `;
}
