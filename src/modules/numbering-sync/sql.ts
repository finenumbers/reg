/**
 * Draft tariff fill and catalog copy. The split is the RTU screen phrase.
 * The copy does not call the tariff functions: those rows are already filled.
 */

import { Prisma } from "@/generated/prisma/client";
import { fillStageSplitSql } from "@/modules/numbering-catalog/decorate";
import { cityLabelSql } from "@/modules/rtu/sql";

export const SIPOUT_PROVIDER = "SipOut";
export const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
export const STAGE_BATCH = 2000;
export const SPLIT_BATCH = 2000;

export type SyncCatalog = "free" | "purchased";

export type StagedNumber = {
  e164: string;
  incomingPeriod: string;
};

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

/** Fill tariff, mask, and client cells for one draft batch. Catalogs stay unlocked. */
export function fillSplitSql(runId: string, limit: number): Prisma.Sql {
  return fillStageSplitSql("numbering_sync_stage", runId, limit);
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
    purchase, subscription, mask, "maskType", sale, premium,
    operator, geography, e164
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
    incoming_period,
    mask,
    mask_type,
    mask_price,
    premium,
    '',
    '',
    e164
  FROM (
    SELECT DISTINCT ON (e164)
      e164, abc, "number", city, region, incoming_period,
      mask, mask_type, mask_price, premium
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
    client,
    mask,
    mask_type,
    mask_price,
    premium,
    '',
    '',
    e164
  FROM (
    SELECT DISTINCT ON (e164)
      e164, abc, "number", city, region, client,
      mask, mask_type, mask_price, premium
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
  rows: readonly StagedNumber[],
): Prisma.Sql {
  const values = rows.map(
    (row) => Prisma.sql`(${runId}, ${catalog}, ${row.e164}, ${row.incomingPeriod})`,
  );
  return Prisma.sql`
    INSERT INTO numbering_sync_stage (run_id, catalog, e164, incoming_period)
    VALUES ${Prisma.join(values)}
    ON CONFLICT DO NOTHING
  `;
}
