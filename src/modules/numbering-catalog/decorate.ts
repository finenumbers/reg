/**
 * Tariff split for a numbering draft, then mask and client cells on the catalogs.
 * The draft fill does not call the mask lookup. A later pass updates stored rows
 * in short batches and lets a live walk take the lease.
 */

import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { isLockTimeout, resplitShouldWait } from "@/modules/numbering-sync/db-retry";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/locks";
import { cityAlertSql, cityLabelSql } from "@/modules/rtu/sql";

const ELEVEN = "^[78][0-9]{10}$";
export const MASK_BATCH = 1000;
export const MASK_BATCH_TX_MS = 60_000;
const BATCH = MASK_BATCH;
const PAUSE_MS = 1000;
const RETRY_MS = 5_000;
const BATCH_TX = { maxWait: 10_000, timeout: MASK_BATCH_TX_MS } as const;

export type MaskProgress = {
  provider: CatalogProvider | null;
  kind: "free" | "purchased" | "client";
  done: number;
  total: number;
};

let maskProgress: MaskProgress | null = null;

export function readMaskProgress(): MaskProgress | null {
  return maskProgress ? { ...maskProgress } : null;
}

const STAGE_TABLES = new Set([
  "numbering_sync_stage",
  "runexis_sync_stage",
  "uis_sync_stage",
  "aurora_sync_stage",
  "exolve_sync_stage",
  "voximplant_sync_stage",
  "mcn_sync_stage",
]);

const PROVIDERS = [
  "SipOut",
  "Runexis",
  "UIS",
  "Aurora Telecom",
  "MTS Exolve",
  "Voximplant",
  "MCN Telecom",
] as const;
export type CatalogProvider = (typeof PROVIDERS)[number];
export type DecorateScope = "full" | "client";

export const SIPOUT_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET sipout_epoch = sipout_epoch + 1 WHERE id = 1";
export const RUNEXIS_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET runexis_epoch = runexis_epoch + 1 WHERE id = 1";
export const UIS_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET uis_epoch = uis_epoch + 1 WHERE id = 1";
export const AURORA_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET aurora_epoch = aurora_epoch + 1 WHERE id = 1";
export const EXOLVE_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET exolve_epoch = exolve_epoch + 1 WHERE id = 1";
export const VOXIMPLANT_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET voximplant_epoch = voximplant_epoch + 1 WHERE id = 1";
export const MCN_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET mcn_epoch = mcn_epoch + 1 WHERE id = 1";

type EpochRow = {
  sipout_epoch: number;
  sipout_done: number;
  runexis_epoch: number;
  runexis_done: number;
  uis_epoch: number;
  uis_done: number;
  aurora_epoch: number;
  aurora_done: number;
  exolve_epoch: number;
  exolve_done: number;
  voximplant_epoch: number;
  voximplant_done: number;
  mcn_epoch: number;
  mcn_done: number;
  decorate_generation: number;
};

function asCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function isProvider(value: string): value is CatalogProvider {
  return (
    value === "SipOut" ||
    value === "Runexis" ||
    value === "UIS" ||
    value === "Aurora Telecom" ||
    value === "MTS Exolve" ||
    value === "Voximplant" ||
    value === "MCN Telecom"
  );
}

/** SQL literal for one numbering source. Anything else is rejected. */
export function providerLiteral(provider: string): Prisma.Sql {
  switch (provider) {
    case "SipOut":
      return Prisma.sql`'SipOut'`;
    case "Runexis":
      return Prisma.sql`'Runexis'`;
    case "UIS":
      return Prisma.sql`'UIS'`;
    case "Aurora Telecom":
      return Prisma.sql`'Aurora Telecom'`;
    case "MTS Exolve":
      return Prisma.sql`'MTS Exolve'`;
    case "Voximplant":
      return Prisma.sql`'Voximplant'`;
    case "MCN Telecom":
      return Prisma.sql`'MCN Telecom'`;
    default:
      throw new Error("Некорректный источник.");
  }
}

function epochNames(provider: CatalogProvider): { epoch: string; done: string } {
  switch (provider) {
    case "SipOut":
      return { epoch: "sipout_epoch", done: "sipout_done" };
    case "Runexis":
      return { epoch: "runexis_epoch", done: "runexis_done" };
    case "UIS":
      return { epoch: "uis_epoch", done: "uis_done" };
    case "Aurora Telecom":
      return { epoch: "aurora_epoch", done: "aurora_done" };
    case "MTS Exolve":
      return { epoch: "exolve_epoch", done: "exolve_done" };
    case "Voximplant":
      return { epoch: "voximplant_epoch", done: "voximplant_done" };
    case "MCN Telecom":
      return { epoch: "mcn_epoch", done: "mcn_done" };
  }
}

/** Mark one provider done only when its epoch is still the value this pass saw. */
export function markDecorateDoneSql(provider: string, seen: number): Prisma.Sql {
  if (!isProvider(provider)) throw new Error("Некорректный источник.");
  const names = epochNames(provider);
  const epoch = Prisma.raw(names.epoch);
  const done = Prisma.raw(names.done);
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET ${done} = ${seen}
    WHERE id = 1 AND ${epoch} = ${seen}
  `;
}

function pair(row: EpochRow, provider: CatalogProvider): { epoch: number; done: number } {
  switch (provider) {
    case "SipOut":
      return { epoch: row.sipout_epoch, done: row.sipout_done };
    case "Runexis":
      return { epoch: row.runexis_epoch, done: row.runexis_done };
    case "UIS":
      return { epoch: row.uis_epoch, done: row.uis_done };
    case "Aurora Telecom":
      return { epoch: row.aurora_epoch, done: row.aurora_done };
    case "MTS Exolve":
      return { epoch: row.exolve_epoch, done: row.exolve_done };
    case "Voximplant":
      return { epoch: row.voximplant_epoch, done: row.voximplant_done };
    case "MCN Telecom":
      return { epoch: row.mcn_epoch, done: row.mcn_done };
  }
}

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

function providerWhere(provider: CatalogProvider | null): Prisma.Sql {
  if (!provider) return Prisma.empty;
  return Prisma.sql`AND provider = ${providerLiteral(provider)}`;
}

/** Tariff split for one draft batch. Mask and client stay empty until the pass. */
export function fillStageSplitSql(
  table: string,
  runId: string,
  limit: number,
): Prisma.Sql {
  if (!STAGE_TABLES.has(table)) throw new Error("Некорректный черновик.");
  const relation = Prisma.raw(`"${table}"`);
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  return Prisma.sql`
    WITH todo AS (
      SELECT catalog, e164
      FROM ${relation}
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
    UPDATE ${relation} AS stage
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

/** Mask price lands in sale. Provider purchase and subscription stay. */
export function freeMaskBatchSql(
  afterId: string,
  provider: CatalogProvider | null = null,
): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const alert = cityAlertSql(Prisma.sql`geo.direction`);
  const only = providerWhere(provider);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM free_numbers
      WHERE id > ${afterId}
        ${only}
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
export function purchasedFullBatchSql(
  afterId: string,
  provider: CatalogProvider | null = null,
): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const alert = cityAlertSql(Prisma.sql`geo.direction`);
  const only = providerWhere(provider);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM purchased_numbers
      WHERE id > ${afterId}
        ${only}
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

function batchSql(
  kind: BatchKind,
  afterId: string,
  provider: CatalogProvider | null,
): Prisma.Sql {
  if (kind === "free") return freeMaskBatchSql(afterId, provider);
  if (kind === "purchased") return purchasedFullBatchSql(afterId, provider);
  return purchasedClientBatchSql(afterId);
}

async function oneBatch(
  kind: BatchKind,
  afterId: string,
  provider: CatalogProvider | null,
): Promise<string[]> {
  try {
    return await prisma.$transaction(async (tx) => {
      for (const sql of RESPLIT_LOCKS) {
        const rows = await tx.$queryRaw<{ run_id: string | null; fresh: boolean }[]>(
          Prisma.raw(sql),
        );
        const row = rows[0];
        if (row?.run_id && row.fresh) throw new SyncBusy();
      }
      const updated = await tx.$queryRaw<{ id: string }[]>(
        batchSql(kind, afterId, provider),
      );
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

async function countCatalog(
  kind: BatchKind,
  provider: CatalogProvider | null,
): Promise<number> {
  const where = provider
    ? Prisma.sql`WHERE provider = ${providerLiteral(provider)}`
    : Prisma.empty;
  const rows =
    kind === "free"
      ? await prisma.$queryRaw<{ n: unknown }[]>`
          SELECT count(*)::int AS n FROM free_numbers ${where}
        `
      : await prisma.$queryRaw<{ n: unknown }[]>`
          SELECT count(*)::int AS n FROM purchased_numbers ${where}
        `;
  return asCount(rows[0]?.n);
}

async function drain(
  kind: BatchKind,
  provider: CatalogProvider | null,
): Promise<boolean> {
  let after = "";
  const started = Date.now();
  let transientTries = 0;
  const total = await countCatalog(kind, provider);
  if (total > 0) maskProgress = { provider, kind, done: 0, total };
  try {
    for (;;) {
      try {
        const ids = await oneBatch(kind, after, provider);
        if (ids.length === 0) return true;
        after = ids[ids.length - 1] ?? after;
        if (
          maskProgress &&
          maskProgress.kind === kind &&
          maskProgress.provider === provider
        ) {
          maskProgress = {
            provider,
            kind,
            total,
            done: maskProgress.done + ids.length,
          };
        }
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
  } finally {
    if (
      maskProgress &&
      maskProgress.kind === kind &&
      maskProgress.provider === provider
    ) {
      maskProgress = null;
    }
  }
}

/** Full pass updates masks on both catalogs and the purchased client. */
export async function runCatalogDecorate(
  scope: DecorateScope | CatalogProvider,
): Promise<boolean> {
  const provider = isProvider(scope) ? scope : null;
  if (scope === "client") return drain("client", null);
  const free = await drain("free", provider);
  if (!free) return false;
  return drain("purchased", provider);
}

async function readEpochs(): Promise<EpochRow | null> {
  const rows = await prisma.$queryRaw<EpochRow[]>`
    SELECT
      sipout_epoch,
      sipout_done,
      runexis_epoch,
      runexis_done,
      uis_epoch,
      uis_done,
      aurora_epoch,
      aurora_done,
      exolve_epoch,
      exolve_done,
      voximplant_epoch,
      voximplant_done,
      mcn_epoch,
      mcn_done,
      decorate_generation
    FROM numbering_catalog_state
    WHERE id = 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    sipout_epoch: asCount(row.sipout_epoch),
    sipout_done: asCount(row.sipout_done),
    runexis_epoch: asCount(row.runexis_epoch),
    runexis_done: asCount(row.runexis_done),
    uis_epoch: asCount(row.uis_epoch),
    uis_done: asCount(row.uis_done),
    aurora_epoch: asCount(row.aurora_epoch),
    aurora_done: asCount(row.aurora_done),
    exolve_epoch: asCount(row.exolve_epoch),
    exolve_done: asCount(row.exolve_done),
    voximplant_epoch: asCount(row.voximplant_epoch),
    voximplant_done: asCount(row.voximplant_done),
    mcn_epoch: asCount(row.mcn_epoch),
    mcn_done: asCount(row.mcn_done),
    decorate_generation: asCount(row.decorate_generation),
  };
}

async function markSeen(row: EpochRow): Promise<void> {
  for (const provider of PROVIDERS) {
    await prisma.$executeRaw(markDecorateDoneSql(provider, pair(row, provider).epoch));
  }
}

function stillDirty(row: EpochRow): boolean {
  return PROVIDERS.some((provider) => {
    const seen = pair(row, provider);
    return seen.epoch > seen.done;
  });
}

async function catchUpProviders(): Promise<void> {
  for (const provider of PROVIDERS) {
    const row = await readEpochs();
    if (!row) return;
    const seen = pair(row, provider);
    if (seen.epoch <= seen.done) continue;
    const ok = await runCatalogDecorate(provider);
    if (!ok) {
      enqueue(async () => {
        await wait(RETRY_MS);
        await catchUpProviders();
      });
      return;
    }
    await prisma.$executeRaw(markDecorateDoneSql(provider, seen.epoch));
  }
  const left = await readEpochs();
  if (left && stillDirty(left)) enqueue(() => catchUpProviders());
}

async function runFullMark(): Promise<void> {
  const before = await readEpochs();
  const ok = await runCatalogDecorate("full");
  if (!ok) {
    enqueue(async () => {
      await wait(RETRY_MS);
      await catchUpProviders();
    });
    return;
  }
  if (before) await markSeen(before);
  await catchUpProviders();
}

let decorateQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  decorateQueue = decorateQueue.then(task).catch((error: unknown) => {
    logger.warn("numbering.decorate.failed", {
      error: error instanceof Error ? error.name : "error",
    });
  });
}

/** Resolves when the mask queue, including a retry already queued, is idle. */
export function whenDecorateIdle(): Promise<void> {
  const watch = async (): Promise<void> => {
    let seen = decorateQueue;
    for (;;) {
      await seen;
      if (decorateQueue === seen) return;
      seen = decorateQueue;
    }
  };
  return watch();
}

/** Queue one full or client pass. Passes run one after another. */
export function requestCatalogDecorate(scope: DecorateScope): void {
  enqueue(async () => {
    if (scope === "full") {
      await runFullMark();
      return;
    }
    const ok = await runCatalogDecorate("client");
    if (!ok) {
      enqueue(async () => {
        await wait(RETRY_MS);
        await catchUpProviders();
      });
      return;
    }
    await catchUpProviders();
  });
}

/** A committed catalog replace already incremented its epoch. Fill whatever is behind. */
export function requestDecorateCatchUp(): void {
  enqueue(() => catchUpProviders());
}

/**
 * The first migration leaves decorate_generation at 0. One successful full pass
 * sets it. A later start fills only a provider whose catalog was replaced.
 */
export function decorateCatalogsIfNeeded(): void {
  enqueue(async () => {
    const row = await readEpochs();
    if (row && row.decorate_generation === 0) {
      const ok = await runCatalogDecorate("full");
      if (ok) {
        await prisma.$executeRaw`
          UPDATE numbering_catalog_state
          SET decorate_generation = 1
          WHERE id = 1 AND decorate_generation = 0
        `;
        await markSeen(row);
      }
    }
    await catchUpProviders();
  });
}
