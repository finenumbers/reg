/**
 * Tariff split for a numbering draft, then mask and client cells on the catalogs.
 * The draft fill does not call the mask lookup. A later pass updates stored rows
 * in short batches and lets a live walk take the lease.
 */

import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { isLockTimeout } from "@/modules/numbering-sync/db-retry";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/locks";
import { refreshPstnRangeSnapshot } from "@/modules/numbering-catalog/pstn-ranges";
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
  kind: "free" | "purchased" | "client" | "resplit-free" | "resplit-purchased";
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
  "finenumbers_sync_stage",
]);

const PROVIDERS = [
  "SipOut",
  "Runexis",
  "UIS",
  "Aurora Telecom",
  "MTS Exolve",
  "Voximplant",
  "MCN Telecom",
  "Finenumbers",
] as const;
export type CatalogProvider = (typeof PROVIDERS)[number];
export type DecorateScope = "full" | "client";

export const SIPOUT_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET sipout_epoch = sipout_epoch + 1, sipout_parsed = 0 WHERE id = 1";
export const RUNEXIS_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET runexis_epoch = runexis_epoch + 1, runexis_parsed = 0 WHERE id = 1";
export const UIS_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET uis_epoch = uis_epoch + 1, uis_parsed = 0 WHERE id = 1";
export const AURORA_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET aurora_epoch = aurora_epoch + 1, aurora_parsed = 0 WHERE id = 1";
export const EXOLVE_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET exolve_epoch = exolve_epoch + 1, exolve_parsed = 0 WHERE id = 1";
export const VOXIMPLANT_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET voximplant_epoch = voximplant_epoch + 1, voximplant_parsed = 0 WHERE id = 1";
export const MCN_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET mcn_epoch = mcn_epoch + 1, mcn_parsed = 0 WHERE id = 1";
export const FINENUMBERS_EPOCH_SQL =
  "UPDATE numbering_catalog_state SET finenumbers_epoch = finenumbers_epoch + 1, finenumbers_parsed = 0 WHERE id = 1";

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
  finenumbers_epoch: number;
  finenumbers_done: number;
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
    value === "MCN Telecom" ||
    value === "Finenumbers"
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
    case "Finenumbers":
      return Prisma.sql`'Finenumbers'`;
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
    case "Finenumbers":
      return { epoch: "finenumbers_epoch", done: "finenumbers_done" };
  }
}

const PARSED_COLUMN: Record<CatalogProvider, string> = {
  SipOut: "sipout_parsed",
  Runexis: "runexis_parsed",
  UIS: "uis_parsed",
  "Aurora Telecom": "aurora_parsed",
  "MTS Exolve": "exolve_parsed",
  Voximplant: "voximplant_parsed",
  "MCN Telecom": "mcn_parsed",
  Finenumbers: "finenumbers_parsed",
};

const CLEAR_PARSED_SQL = Prisma.sql`
  sipout_parsed = 0,
  runexis_parsed = 0,
  uis_parsed = 0,
  aurora_parsed = 0,
  exolve_parsed = 0,
  voximplant_parsed = 0,
  mcn_parsed = 0,
  finenumbers_parsed = 0,
  parsed_pass = ''
`;

const TARIFF_CURSOR_PHASES = [
  "resplit-free",
  "resplit-purchased",
  "free",
  "purchased",
  "provider-free",
  "provider-purchased",
] as const;
const MASK_CURSOR_PHASES = [
  "free",
  "purchased",
  "provider-free",
  "provider-purchased",
] as const;

function phaseList(phases: readonly string[]): Prisma.Sql {
  return Prisma.join(phases.map((phase) => Prisma.sql`${phase}`));
}

function clearCursorSql(phases: readonly string[]): Prisma.Sql {
  const list = phaseList(phases);
  return Prisma.sql`
    cursor_phase = CASE WHEN cursor_phase IN (${list}) THEN '' ELSE cursor_phase END,
    cursor_after = CASE WHEN cursor_phase IN (${list}) THEN '' ELSE cursor_after END,
    cursor_epoch = CASE WHEN cursor_phase IN (${list}) THEN 0 ELSE cursor_epoch END,
    cursor_provider = CASE WHEN cursor_phase IN (${list}) THEN '' ELSE cursor_provider END
  `;
}

/** Tariff snapshot. Clears a resplit or mask cursor and leaves a client cursor. */
export function bumpTariffDebtSql(): Prisma.Sql {
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET resplit_epoch = resplit_epoch + 1,
        mask_epoch = mask_epoch + 1,
        ${CLEAR_PARSED_SQL},
        ${clearCursorSql(TARIFF_CURSOR_PHASES)}
    WHERE id = 1
  `;
}

/** Mask snapshot. Clears a mask cursor and leaves a resplit or client cursor. */
export function bumpMaskDebtSql(): Prisma.Sql {
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET mask_epoch = mask_epoch + 1,
        ${CLEAR_PARSED_SQL},
        ${clearCursorSql(MASK_CURSOR_PHASES)}
    WHERE id = 1
  `;
}

/** Phone snapshot whose descriptions changed. Clears only a client cursor. */
export function bumpClientDebtSql(hash: string): Prisma.Sql {
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET client_epoch = client_epoch + 1,
        client_hash = ${hash},
        ${clearCursorSql(["client"])}
    WHERE id = 1
  `;
}

/** Same descriptions as the rows just replaced. Stores the hash and does not bump. */
export function seedClientHashSql(hash: string): Prisma.Sql {
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET client_hash = ${hash}
    WHERE id = 1 AND client_hash = ''
  `;
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
    case "Finenumbers":
      return { epoch: row.finenumbers_epoch, done: row.finenumbers_done };
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

/** Exactly one covering range writes the cells. Zero or several leave them. */
function pstnLateral(e164: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS hits,
        min(s.operator) AS operator,
        min(s.gar_territory) AS geography
      FROM pstn_range_snapshot s
      WHERE s.abc = substring(${e164} from 2 for 3)
        AND CASE
          WHEN ${e164} ~ '^7[0-9]{10}$'
          THEN substring(${e164} from 5)::int BETWEEN s.range_start AND s.range_end
          ELSE FALSE
        END
    ) pstn ON TRUE
  `;
}

const PSTN_COLUMNS = Prisma.sql`
  CASE WHEN pstn.hits = 1 THEN btrim(pstn.operator) ELSE NULL END AS pstn_operator,
  CASE WHEN pstn.hits = 1 THEN btrim(pstn.geography) ELSE NULL END AS pstn_geography
`;

const PSTN_ASSIGN = Prisma.sql`
  operator = COALESCE(computed.pstn_operator, n.operator),
  geography = COALESCE(computed.pstn_geography, n.geography)
`;

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

/** ABC, local number, city, and region for one page. Mask and client stay. */
export function resplitBatchSql(
  table: "free_numbers" | "purchased_numbers",
  afterId: string,
): Prisma.Sql {
  const city = cityLabelSql(Prisma.sql`geo.direction`);
  const relation = Prisma.raw(table);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM ${relation}
      WHERE id > ${afterId}
        AND e164 <> ''
      ORDER BY id
      LIMIT ${BATCH}
    ),
    computed AS (
      SELECT
        batch.id,
        COALESCE(split.abc, '') AS abc,
        COALESCE(split.telephone, '') AS telephone,
        ${city} AS city,
        COALESCE(btrim(geo.region), '') AS region
      FROM batch
      LEFT JOIN LATERAL cdr_tariff_geo(batch.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, batch.e164) AS split ON TRUE
    ),
    updated AS (
      UPDATE ${relation} AS n
      SET
        abc = computed.abc,
        "number" = computed.telephone,
        city = computed.city,
        region = computed.region
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id
    )
    SELECT id FROM updated ORDER BY id
  `;
}

/** Tariff, mask, and PSTN for one free page. Provider purchase and subscription stay. */
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
        COALESCE(split.abc, '') AS abc,
        COALESCE(split.telephone, '') AS telephone,
        ${city} AS city,
        COALESCE(btrim(geo.region), '') AS region,
        COALESCE(hit.mask, '') AS mask,
        COALESCE(hit.mask_type, '') AS mask_type,
        COALESCE(hit.purchase, '') AS mask_price,
        COALESCE(hit.premium, '') AS premium,
        ${PSTN_COLUMNS}
      FROM batch
      LEFT JOIN LATERAL cdr_tariff_geo(batch.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, batch.e164) AS split ON TRUE
      ${maskLookup(
        city,
        alert,
        Prisma.sql`COALESCE(split.abc, '')`,
        Prisma.sql`COALESCE(split.telephone, '')`,
      )}
      ${pstnLateral(Prisma.sql`batch.e164`)}
    ),
    updated AS (
      UPDATE free_numbers AS n
      SET
        abc = computed.abc,
        "number" = computed.telephone,
        city = computed.city,
        region = computed.region,
        mask = computed.mask,
        "maskType" = computed.mask_type,
        sale = computed.mask_price,
        premium = computed.premium,
        ${PSTN_ASSIGN}
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id, n.provider
    )
    SELECT id, provider FROM updated ORDER BY id
  `;
}

/** Tariff, mask, PSTN, and client for one purchased page. */
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
        COALESCE(split.abc, '') AS abc,
        COALESCE(split.telephone, '') AS telephone,
        ${city} AS city,
        COALESCE(btrim(geo.region), '') AS region,
        COALESCE(hit.mask, '') AS mask,
        COALESCE(hit.mask_type, '') AS mask_type,
        COALESCE(hit.purchase, '') AS mask_price,
        COALESCE(hit.premium, '') AS premium,
        COALESCE(exact_client.client, national_client.client, '') AS client,
        ${PSTN_COLUMNS}
      FROM batch
      LEFT JOIN LATERAL cdr_tariff_geo(batch.e164) AS geo ON TRUE
      LEFT JOIN LATERAL geography_digit_split(geo.abc, geo.numbering, batch.e164) AS split ON TRUE
      ${maskLookup(
        city,
        alert,
        Prisma.sql`COALESCE(split.abc, '')`,
        Prisma.sql`COALESCE(split.telephone, '')`,
      )}
      ${pstnLateral(Prisma.sql`batch.e164`)}
      LEFT JOIN exact_client ON exact_client.phone = batch.e164
      LEFT JOIN national_client
        ON exact_client.client IS NULL
       AND batch.e164 ~ ${ELEVEN}
       AND national_client.national = substring(batch.e164 FROM 2)
    ),
    updated AS (
      UPDATE purchased_numbers AS n
      SET
        abc = computed.abc,
        "number" = computed.telephone,
        city = computed.city,
        region = computed.region,
        mask = computed.mask,
        "maskType" = computed.mask_type,
        purchase = computed.mask_price,
        premium = computed.premium,
        client = computed.client,
        ${PSTN_ASSIGN}
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id, n.provider
    )
    SELECT id, provider FROM updated ORDER BY id
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

type Debt = EpochRow & {
  pstn_range_epoch: number;
  pstn_range_done: number;
  resplit_epoch: number;
  resplit_done: number;
  mask_epoch: number;
  mask_done: number;
  client_epoch: number;
  client_done: number;
  cursor_phase: string;
  cursor_after: string;
  cursor_epoch: number;
  cursor_provider: string;
};

class EpochMoved extends Error {
  constructor() {
    super("epoch-moved");
    this.name = "EpochMoved";
  }
}

function isEpochMoved(error: unknown): boolean {
  if (error instanceof EpochMoved) return true;
  if (error instanceof Error && error.message === "epoch-moved") return true;
  if (error && typeof error === "object" && "cause" in error) {
    return isEpochMoved((error as { cause: unknown }).cause);
  }
  return false;
}

const DEBT_SQL = Prisma.sql`
  SELECT
    sipout_epoch, sipout_done,
    runexis_epoch, runexis_done,
    uis_epoch, uis_done,
    aurora_epoch, aurora_done,
    exolve_epoch, exolve_done,
    voximplant_epoch, voximplant_done,
    mcn_epoch, mcn_done,
    finenumbers_epoch, finenumbers_done,
    pstn_range_epoch, pstn_range_done,
    decorate_generation,
    resplit_epoch, resplit_done,
    mask_epoch, mask_done,
    client_epoch, client_done,
    cursor_phase, cursor_after, cursor_epoch, cursor_provider
  FROM numbering_catalog_state
  WHERE id = 1
`;

function readDebtRow(row: Record<string, unknown>): Debt {
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
    finenumbers_epoch: asCount(row.finenumbers_epoch),
    finenumbers_done: asCount(row.finenumbers_done),
    pstn_range_epoch: asCount(row.pstn_range_epoch),
    pstn_range_done: asCount(row.pstn_range_done),
    decorate_generation: asCount(row.decorate_generation),
    resplit_epoch: asCount(row.resplit_epoch),
    resplit_done: asCount(row.resplit_done),
    mask_epoch: asCount(row.mask_epoch),
    mask_done: asCount(row.mask_done),
    client_epoch: asCount(row.client_epoch),
    client_done: asCount(row.client_done),
    cursor_phase: typeof row.cursor_phase === "string" ? row.cursor_phase : "",
    cursor_after: typeof row.cursor_after === "string" ? row.cursor_after : "",
    cursor_epoch: asCount(row.cursor_epoch),
    cursor_provider: typeof row.cursor_provider === "string" ? row.cursor_provider : "",
  };
}

async function readDebt(): Promise<Debt | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(DEBT_SQL);
  const row = rows[0];
  return row ? readDebtRow(row) : null;
}

export function pstnBatchSql(
  table: "free_numbers" | "purchased_numbers",
  afterId: string,
): Prisma.Sql {
  const relation = Prisma.raw(table);
  return Prisma.sql`
    WITH batch AS (
      SELECT id, e164
      FROM ${relation}
      WHERE id > ${afterId}
      ORDER BY id
      LIMIT ${BATCH}
    ),
    computed AS (
      SELECT batch.id, ${PSTN_COLUMNS}
      FROM batch
      ${pstnLateral(Prisma.sql`batch.e164`)}
    ),
    updated AS (
      UPDATE ${relation} AS n
      SET ${PSTN_ASSIGN}
      FROM computed
      WHERE n.id = computed.id
      RETURNING n.id
    )
    SELECT id FROM updated ORDER BY id
  `;
}

function workSql(
  phase: string,
  afterId: string,
  provider: CatalogProvider | null,
): Prisma.Sql {
  if (phase === "resplit-free") return resplitBatchSql("free_numbers", afterId);
  if (phase === "resplit-purchased") return resplitBatchSql("purchased_numbers", afterId);
  if (phase === "free" || phase === "bootstrap-free" || phase === "provider-free") {
    return freeMaskBatchSql(afterId, provider);
  }
  if (phase === "purchased" || phase === "bootstrap-purchased" || phase === "provider-purchased") {
    return purchasedFullBatchSql(afterId, provider);
  }
  if (phase === "pstn-free") return pstnBatchSql("free_numbers", afterId);
  if (phase === "pstn-purchased") return pstnBatchSql("purchased_numbers", afterId);
  return purchasedClientBatchSql(afterId);
}

function cursorGuard(phase: string, epoch: number, provider: string): Prisma.Sql {
  if (phase === "bootstrap-free" || phase === "bootstrap-purchased") {
    return Prisma.sql`AND decorate_generation = 0`;
  }
  if (phase === "resplit-free" || phase === "resplit-purchased") {
    return Prisma.sql`AND resplit_epoch = ${epoch}`;
  }
  if (phase === "free" || phase === "purchased") {
    return Prisma.sql`AND mask_epoch = ${epoch}`;
  }
  if (phase === "provider-free" || phase === "provider-purchased") {
    if (!isProvider(provider)) throw new Error("Некорректный источник.");
    const names = epochNames(provider);
    return Prisma.sql`AND ${Prisma.raw(names.epoch)} = ${epoch}`;
  }
  if (phase === "pstn-free" || phase === "pstn-purchased") {
    return Prisma.sql`AND pstn_range_epoch = ${epoch}`;
  }
  if (phase === "client") return Prisma.sql`AND client_epoch = ${epoch}`;
  throw new Error("Некорректная фаза.");
}

function counterAssign(column: string, pass: string, add: number): Prisma.Sql {
  const name = Prisma.raw(column);
  return Prisma.sql`${name} = CASE WHEN parsed_pass = ${pass} THEN ${name} + ${add} ELSE ${add} END`;
}

/**
 * Mask and provider passes count committed rows.
 * Resplit, client, and bootstrap leave the counters alone.
 * A new pass name replaces that pass's counters. The same name adds.
 */
function parsedCursorSql(
  phase: string,
  epoch: number,
  provider: string,
  adds: Partial<Record<CatalogProvider, number>>,
): Prisma.Sql {
  if (phase === "free" || phase === "purchased") {
    const pass = `mask:${epoch}`;
    const assigns = PROVIDERS.map((name) =>
      counterAssign(PARSED_COLUMN[name], pass, adds[name] ?? 0),
    );
    return Prisma.sql`, ${Prisma.join(assigns, ", ")}, parsed_pass = ${pass}`;
  }
  if (phase === "provider-free" || phase === "provider-purchased") {
    if (!isProvider(provider)) throw new Error("Некорректный источник.");
    const pass = `provider:${provider}:${epoch}`;
    return Prisma.sql`, ${counterAssign(PARSED_COLUMN[provider], pass, adds[provider] ?? 0)}, parsed_pass = ${pass}`;
  }
  return Prisma.empty;
}

/** Cursor write. The row update and this statement share one transaction. */
export function saveCursorSql(
  phase: string,
  epoch: number,
  provider: string,
  afterId: string,
  adds: Partial<Record<CatalogProvider, number>> = {},
): Prisma.Sql {
  return Prisma.sql`
    UPDATE numbering_catalog_state
    SET cursor_phase = ${phase},
        cursor_after = ${afterId},
        cursor_epoch = ${epoch},
        cursor_provider = ${provider}
        ${parsedCursorSql(phase, epoch, provider, adds)}
    WHERE id = 1
      ${cursorGuard(phase, epoch, provider)}
  `;
}

function countWhere(phase: string, provider: CatalogProvider | null): Prisma.Sql {
  const table =
    phase === "resplit-purchased" ||
    phase === "purchased" ||
    phase === "bootstrap-purchased" ||
    phase === "provider-purchased" ||
    phase === "pstn-purchased" ||
    phase === "client"
      ? "purchased_numbers"
      : "free_numbers";
  const digits =
    phase === "resplit-free" || phase === "resplit-purchased"
      ? Prisma.sql`AND e164 <> ''`
      : Prisma.empty;
  const only = providerWhere(provider);
  return Prisma.sql`FROM ${Prisma.raw(table)} WHERE TRUE ${digits} ${only}`;
}

async function saveCursor(
  tx: Prisma.TransactionClient,
  phase: string,
  epoch: number,
  provider: string,
  afterId: string,
  adds: Partial<Record<CatalogProvider, number>>,
): Promise<void> {
  const saved = await tx.$executeRaw(saveCursorSql(phase, epoch, provider, afterId, adds));
  if (Number(saved) !== 1) throw new EpochMoved();
}

function parsedAdds(
  rows: readonly { provider?: string | null }[],
): Partial<Record<CatalogProvider, number>> {
  const adds: Partial<Record<CatalogProvider, number>> = {};
  for (const row of rows) {
    if (!row.provider || !isProvider(row.provider)) continue;
    adds[row.provider] = (adds[row.provider] ?? 0) + 1;
  }
  return adds;
}

async function runWorkBatch(
  phase: string,
  afterId: string,
  epoch: number,
  provider: CatalogProvider | null,
): Promise<{ ids: string[]; outcome: "ok" | "moved" }> {
  try {
    const ids = await prisma.$transaction(async (tx) => {
      for (const sql of RESPLIT_LOCKS) {
        const locked = await tx.$queryRaw<{ run_id: string | null; fresh: boolean }[]>(
          Prisma.raw(sql),
        );
        const row = locked[0];
        if (row?.run_id && row.fresh) throw new SyncBusy();
      }
      const rows = await tx.$queryRaw<{ id: string; provider?: string | null }[]>(
        workSql(phase, afterId, provider),
      );
      const next = rows.map((row) => row.id);
      if (next.length > 0) {
        await saveCursor(
          tx,
          phase,
          epoch,
          provider ?? "",
          next[next.length - 1] ?? "",
          parsedAdds(rows),
        );
      }
      return next;
    }, BATCH_TX);
    return { ids, outcome: "ok" };
  } catch (error) {
    if (isEpochMoved(error)) return { ids: [], outcome: "moved" };
    throw error;
  }
}

type PhaseRun = {
  phase: string;
  epoch: number;
  provider: CatalogProvider | null;
  kind: MaskProgress["kind"];
};

async function openPhase(run: PhaseRun): Promise<string> {
  const debt = await readDebt();
  if (!debt) return "";
  const same =
    debt.cursor_phase === run.phase &&
    debt.cursor_epoch === run.epoch &&
    debt.cursor_provider === (run.provider ?? "");
  const after = same ? debt.cursor_after : "";
  const where = countWhere(run.phase, run.provider);
  const totals = await prisma.$queryRaw<{ total: number; remain: number }[]>(Prisma.sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE id > ${after})::int AS remain
    ${where}
  `);
  const total = asCount(totals[0]?.total);
  const remain = asCount(totals[0]?.remain);
  maskProgress = {
    provider: run.provider,
    kind: run.kind,
    done: Math.max(0, total - remain),
    total,
  };
  return after;
}

async function walkPhase(run: PhaseRun): Promise<"done" | "moved"> {
  if (pstnPhase(run.phase)) {
    const gate = await readDebt();
    if (!gate || nextDecorateStep(gate).kind !== "pstn") return "moved";
  }
  let after = await openPhase(run);
  for (;;) {
    const fresh = await readDebt();
    if (!fresh) return "moved";
    if (pstnPhase(run.phase) && nextDecorateStep(fresh).kind !== "pstn") return "moved";
    const same =
      fresh.cursor_phase === run.phase &&
      fresh.cursor_epoch === run.epoch &&
      fresh.cursor_provider === (run.provider ?? "");
    after = same ? fresh.cursor_after : "";
    const batch = await runWorkBatch(run.phase, after, run.epoch, run.provider);
    if (batch.outcome === "moved") return "moved";
    if (batch.ids.length === 0) return "done";
    after = batch.ids[batch.ids.length - 1] ?? after;
    if (maskProgress) maskProgress = { ...maskProgress, done: maskProgress.done + batch.ids.length };
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}

async function markPstnDone(seen: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_catalog_state
    SET pstn_range_done = ${seen},
        cursor_phase = CASE WHEN cursor_phase IN ('pstn-free', 'pstn-purchased') THEN '' ELSE cursor_phase END,
        cursor_after = CASE WHEN cursor_phase IN ('pstn-free', 'pstn-purchased') THEN '' ELSE cursor_after END,
        cursor_epoch = CASE WHEN cursor_phase IN ('pstn-free', 'pstn-purchased') THEN 0 ELSE cursor_epoch END,
        cursor_provider = CASE WHEN cursor_phase IN ('pstn-free', 'pstn-purchased') THEN '' ELSE cursor_provider END
    WHERE id = 1 AND pstn_range_epoch = ${seen}
  `;
}

async function markResplitDone(seen: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_catalog_state
    SET resplit_done = ${seen},
        cursor_phase = CASE WHEN cursor_phase IN ('resplit-free', 'resplit-purchased') THEN '' ELSE cursor_phase END,
        cursor_after = CASE WHEN cursor_phase IN ('resplit-free', 'resplit-purchased') THEN '' ELSE cursor_after END,
        cursor_epoch = CASE WHEN cursor_phase IN ('resplit-free', 'resplit-purchased') THEN 0 ELSE cursor_epoch END,
        cursor_provider = CASE WHEN cursor_phase IN ('resplit-free', 'resplit-purchased') THEN '' ELSE cursor_provider END
    WHERE id = 1 AND resplit_epoch = ${seen}
  `;
}

async function markMaskDone(seen: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_catalog_state
    SET mask_done = ${seen},
        cursor_phase = CASE WHEN cursor_phase IN ('free', 'purchased') THEN '' ELSE cursor_phase END,
        cursor_after = CASE WHEN cursor_phase IN ('free', 'purchased') THEN '' ELSE cursor_after END,
        cursor_epoch = CASE WHEN cursor_phase IN ('free', 'purchased') THEN 0 ELSE cursor_epoch END,
        cursor_provider = CASE WHEN cursor_phase IN ('free', 'purchased') THEN '' ELSE cursor_provider END
    WHERE id = 1 AND mask_epoch = ${seen}
  `;
}

async function markClientDone(seen: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE numbering_catalog_state
    SET client_done = ${seen},
        cursor_phase = CASE WHEN cursor_phase = 'client' THEN '' ELSE cursor_phase END,
        cursor_after = CASE WHEN cursor_phase = 'client' THEN '' ELSE cursor_after END,
        cursor_epoch = CASE WHEN cursor_phase = 'client' THEN 0 ELSE cursor_epoch END,
        cursor_provider = CASE WHEN cursor_phase = 'client' THEN '' ELSE cursor_provider END
    WHERE id = 1 AND client_epoch = ${seen}
  `;
}

async function markProviderDone(provider: CatalogProvider, seen: number): Promise<void> {
  const names = epochNames(provider);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE numbering_catalog_state
    SET ${Prisma.raw(names.done)} = ${seen},
        cursor_phase = CASE
          WHEN cursor_phase IN ('provider-free', 'provider-purchased')
           AND cursor_provider = ${provider}
           AND cursor_epoch = ${seen}
          THEN '' ELSE cursor_phase END,
        cursor_after = CASE
          WHEN cursor_phase IN ('provider-free', 'provider-purchased')
           AND cursor_provider = ${provider}
           AND cursor_epoch = ${seen}
          THEN '' ELSE cursor_after END,
        cursor_epoch = CASE
          WHEN cursor_phase IN ('provider-free', 'provider-purchased')
           AND cursor_provider = ${provider}
           AND cursor_epoch = ${seen}
          THEN 0 ELSE cursor_epoch END,
        cursor_provider = CASE
          WHEN cursor_phase IN ('provider-free', 'provider-purchased')
           AND cursor_provider = ${provider}
           AND cursor_epoch = ${seen}
          THEN '' ELSE cursor_provider END
    WHERE id = 1 AND ${Prisma.raw(names.epoch)} = ${seen}
  `);
}

async function markSeen(row: EpochRow): Promise<void> {
  for (const provider of PROVIDERS) {
    const seen = pair(row, provider);
    if (seen.epoch === seen.done) continue;
    await markProviderDone(provider, seen.epoch);
  }
}

export type DecorateStep =
  | { kind: "bootstrap" }
  | { kind: "resplit" }
  | { kind: "mask" }
  | { kind: "provider"; provider: CatalogProvider }
  | { kind: "pstn" }
  | { kind: "client" }
  | { kind: "idle" };

/** Next catalog debt. An open provider epoch comes before the range-snapshot walk. */
export function nextDecorateStep(
  debt: EpochRow & {
    decorate_generation: number;
    resplit_epoch: number;
    resplit_done: number;
    mask_epoch: number;
    mask_done: number;
    pstn_range_epoch: number;
    pstn_range_done: number;
    client_epoch: number;
    client_done: number;
  },
): DecorateStep {
  if (debt.decorate_generation === 0) return { kind: "bootstrap" };
  if (debt.resplit_epoch > debt.resplit_done) return { kind: "resplit" };
  if (debt.mask_epoch > debt.mask_done) return { kind: "mask" };
  const behind = PROVIDERS.find((provider) => {
    const seen = pair(debt, provider);
    return seen.epoch > seen.done;
  });
  if (behind) return { kind: "provider", provider: behind };
  if (debt.pstn_range_epoch > debt.pstn_range_done) return { kind: "pstn" };
  if (debt.client_epoch > debt.client_done) return { kind: "client" };
  return { kind: "idle" };
}

/** The range download waits until source, mask, and resplit debt is closed. */
export function snapshotAfterDebt(step: DecorateStep): boolean {
  return step.kind === "pstn" || step.kind === "idle";
}

function pstnPhase(phase: string): boolean {
  return phase === "pstn-free" || phase === "pstn-purchased";
}

async function snapshotStop(): Promise<boolean> {
  const debt = await readDebt();
  if (!debt) return true;
  return !snapshotAfterDebt(nextDecorateStep(debt));
}

async function settleDebt(): Promise<void> {
  let snapshotChecked = false;
  for (;;) {
    const debt = await readDebt();
    if (!debt) return;
    maskProgress = null;
    const step = nextDecorateStep(debt);
    if (
      step.kind === "bootstrap" ||
      step.kind === "resplit" ||
      step.kind === "mask" ||
      step.kind === "provider"
    ) {
      snapshotChecked = false;
    }
    if (step.kind === "bootstrap") {
      const free = await walkPhase({
        phase: "bootstrap-free",
        epoch: 0,
        provider: null,
        kind: "free",
      });
      if (free === "moved") continue;
      const purchased = await walkPhase({
        phase: "bootstrap-purchased",
        epoch: 0,
        provider: null,
        kind: "purchased",
      });
      if (purchased === "moved") continue;
      await prisma.$executeRaw`
        UPDATE numbering_catalog_state
        SET decorate_generation = 1,
            cursor_phase = CASE WHEN cursor_phase IN ('bootstrap-free', 'bootstrap-purchased') THEN '' ELSE cursor_phase END,
            cursor_after = CASE WHEN cursor_phase IN ('bootstrap-free', 'bootstrap-purchased') THEN '' ELSE cursor_after END,
            cursor_epoch = CASE WHEN cursor_phase IN ('bootstrap-free', 'bootstrap-purchased') THEN 0 ELSE cursor_epoch END,
            cursor_provider = CASE WHEN cursor_phase IN ('bootstrap-free', 'bootstrap-purchased') THEN '' ELSE cursor_provider END
        WHERE id = 1 AND decorate_generation = 0
      `;
      await markSeen(debt);
      continue;
    }
    if (step.kind === "resplit") {
      const free = await walkPhase({
        phase: "resplit-free",
        epoch: debt.resplit_epoch,
        provider: null,
        kind: "resplit-free",
      });
      if (free === "moved") continue;
      const purchased = await walkPhase({
        phase: "resplit-purchased",
        epoch: debt.resplit_epoch,
        provider: null,
        kind: "resplit-purchased",
      });
      if (purchased === "moved") continue;
      await markResplitDone(debt.resplit_epoch);
      continue;
    }
    if (step.kind === "mask") {
      const free = await walkPhase({
        phase: "free",
        epoch: debt.mask_epoch,
        provider: null,
        kind: "free",
      });
      if (free === "moved") continue;
      const purchased = await walkPhase({
        phase: "purchased",
        epoch: debt.mask_epoch,
        provider: null,
        kind: "purchased",
      });
      if (purchased === "moved") continue;
      await markMaskDone(debt.mask_epoch);
      await markSeen(debt);
      continue;
    }
    if (step.kind === "provider") {
      const behind = step.provider;
      const seen = pair(debt, behind);
      const free = await walkPhase({
        phase: "provider-free",
        epoch: seen.epoch,
        provider: behind,
        kind: "free",
      });
      if (free === "moved") continue;
      const purchased = await walkPhase({
        phase: "provider-purchased",
        epoch: seen.epoch,
        provider: behind,
        kind: "purchased",
      });
      if (purchased === "moved") continue;
      await markProviderDone(behind, seen.epoch);
      continue;
    }
    if (step.kind === "client") {
      const clients = await walkPhase({
        phase: "client",
        epoch: debt.client_epoch,
        provider: null,
        kind: "client",
      });
      if (clients === "moved") continue;
      await markClientDone(debt.client_epoch);
      continue;
    }
    if (!snapshotChecked) {
      const outcome = await refreshPstnRangeSnapshot(snapshotStop);
      if (outcome === "yielded") continue;
      snapshotChecked = true;
      continue;
    }
    if (step.kind === "pstn") {
      const free = await walkPhase({
        phase: "pstn-free",
        epoch: debt.pstn_range_epoch,
        provider: null,
        kind: "free",
      });
      if (free === "moved") {
        snapshotChecked = false;
        continue;
      }
      const purchased = await walkPhase({
        phase: "pstn-purchased",
        epoch: debt.pstn_range_epoch,
        provider: null,
        kind: "purchased",
      });
      if (purchased === "moved") {
        snapshotChecked = false;
        continue;
      }
      await markPstnDone(debt.pstn_range_epoch);
      continue;
    }
    return;
  }
}

let chain: Promise<void> = Promise.resolve();
let lastRetryLog = 0;

function decorateError(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось обновить каталог.";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((error: unknown) => {
    const now = Date.now();
    if (now - lastRetryLog >= 60_000) {
      lastRetryLog = now;
      logger.error("numbering.decorate.retry", { message: decorateError(error) });
    }
  });
}

async function settleUntilClear(): Promise<void> {
  for (;;) {
    try {
      await settleDebt();
      return;
    } catch (error) {
      if (error instanceof SyncBusy || isLockTimeout(error)) {
        const now = Date.now();
        if (now - lastRetryLog >= 60_000) {
          lastRetryLog = now;
          logger.error("numbering.decorate.retry", { message: "Каталог занят загрузкой." });
        }
      } else {
        const now = Date.now();
        if (now - lastRetryLog >= 60_000) {
          lastRetryLog = now;
          logger.error("numbering.decorate.retry", { message: decorateError(error) });
        }
      }
      await wait(RETRY_MS);
    }
  }
}

/** The queue is busy until every stored epoch has been caught up. */
export function whenDecorateIdle(): Promise<void> {
  const pending = chain;
  return pending.then(() => chain);
}

export function requestCatalogDecorate(_scope?: DecorateScope): void {
  enqueue(() => settleUntilClear());
}

/** A committed catalog replace already incremented its epoch. Fill whatever is behind. */
export function requestDecorateCatchUp(): void {
  enqueue(() => settleUntilClear());
}

/**
 * The first migration leaves decorate_generation at 0. One successful full pass
 * sets it. A later start continues from the stored cursor.
 */
export function decorateCatalogsIfNeeded(): void {
  enqueue(() => settleUntilClear());
}
