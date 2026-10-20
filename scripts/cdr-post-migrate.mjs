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
]);

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
