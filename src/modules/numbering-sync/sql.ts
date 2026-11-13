/**
 * Draft tariff fill and catalog copy. The split is the RTU screen phrase.
 * The copy does not call the tariff functions: those rows are already filled.
 */

import { Prisma } from "@/generated/prisma/client";
import { cityLabelSql } from "@/modules/rtu/sql";

export const SIPOUT_PROVIDER = "SipOut";
export const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
export const STAGE_BATCH = 2000;
export const SPLIT_BATCH = 2000;

export type SyncCatalog = "free" | "purchased";

export type PublishDecision = {
  held: boolean;
  stagedFree: number;
  insertedFree: number;
  stagedPurchased: number;
  insertedPurchased: number;
};

/** Commit only when the lease is held and every staged number was inserted. */
export function decidePublish(input: PublishDecision): "commit" | "rollback" {
  if (!input.held) return "rollback";
  if (input.stagedFree !== input.insertedFree) return "rollback";
  if (input.stagedPurchased !== input.insertedPurchased) return "rollback";
  return "commit";
}

/** Fill tariff cells for one batch of the draft. The catalogs are not locked. */
export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH todo AS (
      SELECT catalog, e164
      FROM numbering_sync_stage
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
    UPDATE numbering_sync_stage AS stage
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

export const STAGED_COUNT_SQL = `
  SELECT count(*)::int AS count
  FROM (
    SELECT DISTINCT e164
    FROM numbering_sync_stage
    WHERE run_id = $1 AND catalog = $2
  ) AS src
`;

export const FREE_COPY_SQL = `
  INSERT INTO free_numbers (
    id, provider, abc, "number", category, city, region,
    mask, "maskType", "incomingPurchase", "incomingPeriod",
    purchase, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'SipOut',
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
  FROM (
    SELECT DISTINCT ON (e164) e164, abc, "number", city, region
    FROM numbering_sync_stage
    WHERE run_id = $1 AND catalog = 'free' AND ready = true
    ORDER BY e164
  ) AS src
`;

export const PURCHASED_COPY_SQL = `
  INSERT INTO purchased_numbers (
    id, provider, abc, "number", category, city, region, client,
    mask, "maskType", purchase, premium, operator, geography, e164
  )
  SELECT
    gen_random_uuid()::text,
    'SipOut',
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
  FROM (
    SELECT DISTINCT ON (e164) e164, abc, "number", city, region
    FROM numbering_sync_stage
    WHERE run_id = $1 AND catalog = 'purchased' AND ready = true
    ORDER BY e164
  ) AS src
`;

/** Recompute the four tariff cells for every stored national number. */
export function recomputeSql(table: "free_numbers" | "purchased_numbers"): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    UPDATE ${Prisma.raw(table)} AS n
    SET
      abc = COALESCE(split.abc, ''),
      "number" = COALESCE(split.telephone, ''),
      city = ${city},
      region = COALESCE(btrim(geo.region), '')
    FROM (
      SELECT id, e164 FROM ${Prisma.raw(table)} WHERE e164 <> ''
    ) src
    LEFT JOIN LATERAL cdr_tariff_geo(src.e164) AS geo ON TRUE
    LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, src.e164) AS split ON TRUE
    WHERE n.id = src.id
  `;
}

export function stageInsertSql(
  runId: string,
  catalog: SyncCatalog,
  dids: readonly string[],
): Prisma.Sql {
  const rows = dids.map((e164) => Prisma.sql`(${runId}, ${catalog}, ${e164})`);
  return Prisma.sql`
    INSERT INTO numbering_sync_stage (run_id, catalog, e164)
    VALUES ${Prisma.join(rows)}
    ON CONFLICT DO NOTHING
  `;
}
