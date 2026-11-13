/**
 * Catalog replace and tariff recompute. The split is the RTU screen phrase.
 */

import { Prisma } from "@/generated/prisma/client";
import { cityLabelSql } from "@/modules/rtu/sql";

export const SIPOUT_PROVIDER = "SipOut";
export const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
export const STAGE_BATCH = 500;

export type SyncCatalog = "free" | "purchased";

const splitFrom = (runId: string, catalog: SyncCatalog) => Prisma.sql`
  FROM (
    SELECT DISTINCT e164
    FROM numbering_sync_stage
    WHERE run_id = ${runId} AND catalog = ${catalog}
  ) src
  LEFT JOIN LATERAL cdr_tariff_geo(src.e164) AS geo ON TRUE
  LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, src.e164) AS split ON TRUE
`;

/** One insert of the staged digits. City and region come from the tariff row. */
export function publishInsertSql(catalog: SyncCatalog, runId: string): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const from = splitFrom(runId, catalog);
  if (catalog === "free") {
    return Prisma.sql`
      INSERT INTO free_numbers (
        id, provider, abc, "number", category, city, region,
        mask, "maskType", "incomingPurchase", "incomingPeriod",
        purchase, premium, operator, geography, e164
      )
      SELECT
        gen_random_uuid()::text,
        ${SIPOUT_PROVIDER},
        COALESCE(split.abc, ''),
        COALESCE(split.telephone, ''),
        '',
        ${city},
        COALESCE(btrim(geo.region), ''),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        src.e164
      ${from}
    `;
  }
  return Prisma.sql`
    INSERT INTO purchased_numbers (
      id, provider, abc, "number", category, city, region, client,
      mask, "maskType", purchase, premium, operator, geography, e164
    )
    SELECT
      gen_random_uuid()::text,
      ${SIPOUT_PROVIDER},
      COALESCE(split.abc, ''),
      COALESCE(split.telephone, ''),
      '',
      ${city},
      COALESCE(btrim(geo.region), ''),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      src.e164
    ${from}
  `;
}

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
