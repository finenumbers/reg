/**
 * After prisma migrate deploy, decide which CDR rewrites still block startup.
 * The migrate log is stdin. A quiet deploy does not read cdr_records.
 * A migration that moved rateGeneration ahead of ratedGeneration leaves the
 * tariff pass to the app job. Equating the generations here would skip that job.
 * A migration that does not name the tariff backfill does not scan cdr_records.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Migrations that do not rewrite leftover category labels. */
export const LABEL_FREE_MIGRATIONS = new Set([
  "20261020190000_closed_dial_prefixes",
  "20261020220000_dial_exceptions",
  "20261021021000_smg_trace_labels",
  "20261021140000_radius_calls",
  "20261021160000_radius_ingest_age",
  "20261021170000_parking_target",
  "20261022120000_smg_cdr_af_labels",
  "20261022180000_smg_af_charts",
  "20261022190000_smg_node_antifraud",
  "20261031120000_number_geography_refresh",
  "20261031180000_drop_enrich_jobs",
  "20261101130000_did_api",
  "20261102140000_rtu_soap_credentials",
  "20261102150000_rtu_soap_ca",
  "20261105020000_reg_user_agent",
  "20261106180000_cdr_tariff_abc",
  "20261107123000_tariff_numbering",
  "20261107161000_tariff_region",
  "20261107170000_geography_mobile_abc",
  "20261107190000_geography_did_source",
  "20261108020000_rtu_screen",
  "20261109120000_number_masks",
  "20261109150000_vats_boss",
  "20261111180000_zabbix_settings",
  "20261111193000_zabbix_graph_titles",
  "20261113003000_number_masks_column_order",
  "20261113043000_rtu_screen_masks",
  "20261113120000_mask_hyphen",
  "20261113143000_marking_labels",
  "20261113170000_marking_working_set",
  "20261113193000_marking_supplier",
  "20261114001000_free_numbers",
  "20261114020000_purchased_numbers",
  "20261114040000_sipout_sync",
  "20261114053000_sipout_source_stage",
  "20261114150000_runexis_free",
  "20261115120000_runexis_catalogs",
  "20261115140000_uis_source",
  "20261116010000_catalog_sale_columns",
  "20261116020000_catalog_decorate_epoch",
  "20261116040000_geography_abc_text",
  "20261116060000_aurora_source",
  "20261116070000_aurora_file_links",
  "20261116080000_exolve_source",
  "20261116170000_voximplant_source",
  "20261116191000_mcn_source",
  "20261117010000_catalog_decorate_cursor",
  "20261117020000_sync_card_counts",
  "20261117150000_finenumbers_source",
  "20261117180000_pstn_range_span",
  "20261117210000_drop_catalog_category",
  "20261118160000_rtp_leg_index",
  "20261118210000_purchased_provider_prices",
  "20261119090000_sync_side_loads",
  "20261119110000_decorate_side_scope",
]);

/**
 * Migrations that rewrite stored CDR labels. None today. A migration that is
 * neither here nor in LABEL_FREE_MIGRATIONS still runs the label pass, so this
 * list only records the decision for the migration guard test.
 */
export const LABEL_REWRITING_MIGRATIONS = new Set();

/**
 * Migrations whose SQL says stored CDR rows are rewritten by
 * scripts/cdr-tariff-backfill.mjs. A migration that only moves rateGeneration
 * is not here: the app job does that pass. A migration that changes neither
 * labels nor tariffs must be added to LABEL_FREE_MIGRATIONS.
 */
export const TARIFF_BLOCKING_MIGRATIONS = new Set([
  "20261006210000_cdr_tariff_rating",
  "20261006223000_cdr_tariff_price",
  "20261006225000_cdr_internal_zero_cost",
  "20261007143000_cdr_call_geography",
  "20261010120000_cdr_terminator_capacity",
  "20261020170000_tariff_digit_length",
  "20261020180000_tariff_digit_lengths",
  "20261020190000_closed_dial_prefixes",
]);

export function appliedMigrations(log) {
  const names = new Set();
  for (const match of log.matchAll(/Applying migration `([^`]+)`/g)) {
    names.add(match[1]);
  }
  for (const match of log.matchAll(/└─ (\d{14}_[a-z0-9_]+)\//g)) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * @param {string} log
 * @param {{ rateGeneration: number, ratedGeneration: number } | null} state
 */
export function planPostMigrate(log, state) {
  const applied = appliedMigrations(log);
  const quiet = log.includes("No pending migrations to apply.");
  if (quiet && applied.length === 0) return { callClass: false, tariff: false };
  if (applied.length === 0) return { callClass: true, tariff: true };
  return {
    callClass: applied.some((name) => !LABEL_FREE_MIGRATIONS.has(name)),
    tariff:
      applied.some((name) => TARIFF_BLOCKING_MIGRATIONS.has(name)) &&
      !(state && state.rateGeneration > state.ratedGeneration),
  };
}

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} exited ${code}`));
    });
  });
}

async function readGeneration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT "rateGeneration", "ratedGeneration"
       FROM tariff_import_state
       WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      rateGeneration: Number(row.rateGeneration),
      ratedGeneration: Number(row.ratedGeneration),
    };
  } finally {
    await client.end();
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const log = await readStdin();
  const applied = appliedMigrations(log);
  const quiet = log.includes("No pending migrations to apply.");
  const state = quiet && applied.length === 0 ? null : await readGeneration();
  const plan = planPostMigrate(log, state);
  if (!plan.callClass && !plan.tariff) {
    console.log("cdr post-migrate: schema is current, journal is left for the app");
    return;
  }
  if (plan.callClass) {
    console.log("cdr post-migrate: category label backfill");
    await runNode(path.join(HERE, "cdr-call-class-backfill.mjs"));
  } else {
    console.log("cdr post-migrate: category label backfill skipped");
  }
  if (plan.tariff) {
    console.log("cdr post-migrate: tariff backfill");
    await runNode(path.join(HERE, "cdr-tariff-backfill.mjs"));
  } else {
    console.log("cdr post-migrate: tariff backfill left to the app job");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
