/**
 * Mask, type, sale or purchase, premium, and the purchased client.
 * The draft fill runs this before the catalog lock. A later pass updates
 * rows already stored, in short batches, and lets a live walk take the lease.
 */

import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { isLockTimeout, resplitShouldWait } from "@/modules/numbering-sync/db-retry";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/locks";
import { cityAlertSql, cityLabelSql } from "@/modules/rtu/sql";

const ELEVEN = "^[78][0-9]{10}$";
const BATCH = 500;
const PAUSE_MS = 1000;
const RETRY_MS = 5_000;
const BATCH_TX = { maxWait: 10_000, timeout: 30_000 } as const;

const STAGE_TABLES = new Set([
  "numbering_sync_stage",
  "runexis_sync_stage",
  "uis_sync_stage",
]);

export type DecorateScope = "full" | "client";

function clientCtes(): Prisma.Sql {
  return Prisma.sql`
    described AS (
      SELECT
        btrim("endpointNumber") AS phone,
        btrim(data->>'Описание') AS client,
        name
      FROM phone_endpoints
      WHERE "endpointNumber" IS NOT NULL
        AND btrim("endpointNumber") <> ''
        AND NULLIF(btrim(COALESCE(data->>'Описание', '')), '') IS NOT NULL
    ),
    exact_client AS (
      SELECT DISTINCT ON (phone)
        phone,
        client
      FROM described
      ORDER BY phone, name
    ),
    national_client AS (
      SELECT national, min(client) AS client
      FROM (
        SELECT substring(phone FROM 2) AS national, client
        FROM described
        WHERE phone ~ ${ELEVEN}
      ) AS pairs
      GROUP BY national
      HAVING count(DISTINCT client) = 1
    )
  `;
}

function maskLookup(
  city: Prisma.Sql,
  alert: Prisma.Sql,
  abc: Prisma.Sql,
  telephone: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL rtu_mask_lookup(${city}, ${alert}, ${abc}, ${telephone}) AS hit ON TRUE
  `;
}

/** Tariff split, mask cells, and the purchased client for one draft batch. */
export function fillStageSplitSql(table: string, runId: string, limit: number): Prisma.Sql {
  if (!STAGE_TABLES.has(table)) throw new Error("Некорректный черновик.");
  const relation = Prisma.raw(`"${table}"`);
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const alert = cityAlertSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH todo AS (
      SELECT catalog, e164
      FROM ${relation}
      WHERE run_id = ${runId} AND ready = false
      ORDER BY catalog, e164
      LIMIT ${limit}
    ),
    ${clientCtes()},
    tariffed AS (
      SELECT
        todo.catalog,
        todo.e164,
        COALESCE(split.abc, '') AS abc,
        COALESCE(split.telephone, '') AS telephone,
        ${city} AS city,
        ${alert} AS city_alert,
        COALESCE(btrim(geo.region), '') AS region
      FROM todo
      LEFT JOIN LATERAL cdr_tariff_geo(todo.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, todo.e164) AS split ON TRUE
    ),
    computed AS (
      SELECT
        tariffed.catalog,
        tariffed.e164,
        tariffed.abc,
        tariffed.telephone,
        tariffed.city,
        tariffed.region,
        COALESCE(hit.mask, '') AS mask,
        COALESCE(hit.mask_type, '') AS mask_type,
        COALESCE(hit.purchase, '') AS mask_price,
        COALESCE(hit.premium, '') AS premium,
        CASE
          WHEN tariffed.catalog = 'purchased'
            THEN COALESCE(exact_client.client, national_client.client, '')
          ELSE ''
        END AS client
      FROM tariffed
      ${maskLookup(
        Prisma.sql`tariffed.city`,
        Prisma.sql`tariffed.city_alert`,
        Prisma.sql`tariffed.abc`,
        Prisma.sql`tariffed.telephone`,
      )}
      LEFT JOIN exact_client
        ON tariffed.catalog = 'purchased'
       AND exact_client.phone = tariffed.e164
      LEFT JOIN national_client
        ON tariffed.catalog = 'purchased'
       AND exact_client.client IS NULL
       AND tariffed.e164 ~ ${ELEVEN}
       AND national_client.national = substring(tariffed.e164 FROM 2)
    )
    UPDATE ${relation} AS stage
    SET
      abc = computed.abc,
      "number" = computed.telephone,
      city = computed.city,
      region = computed.region,
      mask = computed.mask,
      mask_type = computed.mask_type,
      mask_price = computed.mask_price,
      premium = computed.premium,
      client = computed.client,
      ready = true
    FROM computed
    WHERE stage.run_id = ${runId}
      AND stage.catalog = computed.catalog
      AND stage.e164 = computed.e164
  `;
}

/** Mask price lands in sale. Provider purchase and subscription stay. */
export function freeMaskBatchSql(afterId: string): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const alert = cityAlertSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM free_numbers
      WHERE id > ${afterId}
      ORDER BY id
      LIMIT ${BATCH}
    ),
    computed AS (
      SELECT
        batch.id,
        COALESCE(hit.mask, '') AS mask,
        COALESCE(hit.mask_type, '') AS mask_type,
        COALESCE(hit.purchase, '') AS mask_price,
        COALESCE(hit.premium, '') AS premium
      FROM batch
      LEFT JOIN LATERAL cdr_tariff_geo(batch.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, batch.e164) AS split ON TRUE
      ${maskLookup(
        city,
        alert,
        Prisma.sql`COALESCE(split.abc, '')`,
        Prisma.sql`COALESCE(split.telephone, '')`,
      )}
    ),
    updated AS (
      UPDATE free_numbers AS n
      SET
        mask = computed.mask,
        "maskType" = computed.mask_type,
        sale = computed.mask_price,
        premium = computed.premium
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id
    )
    SELECT id FROM updated ORDER BY id
  `;
}

/** Mask price lands in purchase. Client comes from the phone description. */
export function purchasedFullBatchSql(afterId: string): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const alert = cityAlertSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM purchased_numbers
      WHERE id > ${afterId}
      ORDER BY id
      LIMIT ${BATCH}
    ),
    ${clientCtes()},
    computed AS (
      SELECT
        batch.id,
        COALESCE(hit.mask, '') AS mask,
        COALESCE(hit.mask_type, '') AS mask_type,
        COALESCE(hit.purchase, '') AS mask_price,
        COALESCE(hit.premium, '') AS premium,
        COALESCE(exact_client.client, national_client.client, '') AS client
      FROM batch
      LEFT JOIN LATERAL cdr_tariff_geo(batch.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, batch.e164) AS split ON TRUE
      ${maskLookup(
        city,
        alert,
        Prisma.sql`COALESCE(split.abc, '')`,
        Prisma.sql`COALESCE(split.telephone, '')`,
      )}
      LEFT JOIN exact_client ON exact_client.phone = batch.e164
      LEFT JOIN national_client
        ON exact_client.client IS NULL
       AND batch.e164 ~ ${ELEVEN}
       AND national_client.national = substring(batch.e164 FROM 2)
    ),
    updated AS (
      UPDATE purchased_numbers AS n
      SET
        mask = computed.mask,
        "maskType" = computed.mask_type,
        purchase = computed.mask_price,
        premium = computed.premium,
        client = computed.client
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id
    )
    SELECT id FROM updated ORDER BY id
  `;
}

/** Phone sync refreshes the client and leaves the mask cells. */
export function purchasedClientBatchSql(afterId: string): Prisma.Sql {
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM purchased_numbers
      WHERE id > ${afterId}
      ORDER BY id
      LIMIT ${BATCH}
    ),
    ${clientCtes()},
    computed AS (
      SELECT
        batch.id,
        COALESCE(exact_client.client, national_client.client, '') AS client
      FROM batch
      LEFT JOIN exact_client ON exact_client.phone = batch.e164
      LEFT JOIN national_client
        ON exact_client.client IS NULL
       AND batch.e164 ~ ${ELEVEN}
       AND national_client.national = substring(batch.e164 FROM 2)
    ),
    updated AS (
      UPDATE purchased_numbers AS n
      SET client = computed.client
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id
    )
    SELECT id FROM updated ORDER BY id
  `;
}

type BatchKind = "free" | "purchased" | "client";

function batchSql(kind: BatchKind, afterId: string): Prisma.Sql {
  if (kind === "free") return freeMaskBatchSql(afterId);
  if (kind === "purchased") return purchasedFullBatchSql(afterId);
  return purchasedClientBatchSql(afterId);
}

async function oneBatch(kind: BatchKind, afterId: string): Promise<string[]> {
  try {
    return await prisma.$transaction(async (tx) => {
      for (const sql of RESPLIT_LOCKS) {
        const rows = await tx.$queryRaw<{ run_id: string | null; fresh: boolean }[]>(
          Prisma.raw(sql),
        );
        const row = rows[0];
        if (row?.run_id && row.fresh) throw new SyncBusy();
      }
      const updated = await tx.$queryRaw<{ id: string }[]>(batchSql(kind, afterId));
      return updated.map((row) => row.id);
    }, BATCH_TX);
  } catch (error) {
    if (isLockTimeout(error)) throw new SyncBusy();
    throw error;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain(kind: BatchKind): Promise<boolean> {
  let after = "";
  const started = Date.now();
  let transientTries = 0;
  for (;;) {
    try {
      const ids = await oneBatch(kind, after);
      if (ids.length === 0) return true;
      after = ids[ids.length - 1] ?? after;
      transientTries = 0;
      await wait(PAUSE_MS);
    } catch (error) {
      const elapsed = Date.now() - started;
      if (!resplitShouldWait(error, elapsed, transientTries)) {
        if (error instanceof SyncBusy) {
          logger.warn("numbering.decorate.gave_up", { kind, waitedMs: elapsed });
          return false;
        }
        throw error;
      }
      if (!(error instanceof SyncBusy)) transientTries += 1;
      await wait(RETRY_MS);
    }
  }
}

/** Full pass updates masks on both catalogs and the purchased client. */
export async function runCatalogDecorate(scope: DecorateScope): Promise<boolean> {
  if (scope === "full") {
    const free = await drain("free");
    if (!free) return false;
    return drain("purchased");
  }
  return drain("client");
}

let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((error: unknown) => {
    logger.warn("numbering.decorate.failed", {
      error: error instanceof Error ? error.name : "error",
    });
  });
}

/** Queue one pass. Passes run one after another. */
export function requestCatalogDecorate(scope: DecorateScope): void {
  enqueue(() => runCatalogDecorate(scope).then(() => undefined));
}

/**
 * The migration leaves decorate_generation at 0. One successful full pass
 * sets it. A later start does not scan the catalogs again.
 */
export function decorateCatalogsIfNeeded(): void {
  enqueue(async () => {
    const rows = await prisma.$queryRaw<{ decorate_generation: number }[]>`
      SELECT decorate_generation
      FROM numbering_catalog_state
      WHERE id = 1
    `;
    if ((rows[0]?.decorate_generation ?? 1) !== 0) return;
    const ok = await runCatalogDecorate("full");
    if (!ok) return;
    await prisma.$executeRaw`
      UPDATE numbering_catalog_state
      SET decorate_generation = 1
      WHERE id = 1 AND decorate_generation = 0
    `;
  });
}
