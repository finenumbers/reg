/**
 * Fill tariff_direction / tariff_charge / tariff_cost / tariff_profit
 * on every existing cdr_records row. Idempotent: a row is rewritten only
 * when the four cells change. Compose migrator runs this after migrate
 * deploy. The app must not start until this script exits 0.
 *
 * The batch SQL is kept identical to src/modules/traffic/tariff-rate/sql.ts.
 */
import pg from "pg";

const BATCH = 5000;

const CDR_TARIFF_BATCH_SQL = `
WITH batch AS (
  SELECT
    c.id,
    c.call_category,
    c.call_status,
    c.bill_dnis,
    c.elapsed_time
  FROM cdr_records AS c
  WHERE c.id > $1
  ORDER BY c.id
  LIMIT $2
),
rated AS (
  SELECT
    b.id,
    r.direction,
    r.charge,
    r.cost,
    r.profit
  FROM batch AS b
  CROSS JOIN LATERAL cdr_rate_call(
    b.call_category,
    b.call_status,
    b.bill_dnis,
    b.elapsed_time
  ) AS r
),
updated AS (
  UPDATE cdr_records AS c
  SET
    tariff_direction = rated.direction,
    tariff_charge = rated.charge,
    tariff_cost = rated.cost,
    tariff_profit = rated.profit
  FROM rated
  WHERE c.id = rated.id
    AND (c.tariff_direction, c.tariff_charge, c.tariff_cost, c.tariff_profit)
      IS DISTINCT FROM (rated.direction, rated.charge, rated.cost, rated.profit)
  RETURNING c.id
)
SELECT
  (SELECT b.id FROM batch AS b ORDER BY b.id DESC LIMIT 1) AS last_id,
  (SELECT count(*) FROM batch) AS scanned,
  (SELECT count(*) FROM updated) AS updated
`.trim();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

function asNumber(value) {
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

async function main() {
  await client.connect();
  let cursor = "";
  let scannedTotal = 0;
  let updatedTotal = 0;
  for (;;) {
    const result = await client.query(CDR_TARIFF_BATCH_SQL, [cursor, BATCH]);
    const row = result.rows[0];
    const scanned = asNumber(row?.scanned);
    if (scanned === 0) break;
    const updated = asNumber(row?.updated);
    const lastId = row?.last_id;
    if (typeof lastId !== "string" || lastId.length === 0) {
      throw new Error("cdr tariff batch returned rows without last_id");
    }
    scannedTotal += scanned;
    updatedTotal += updated;
    cursor = lastId;
    console.log(
      `cdr tariff rate: scanned ${scannedTotal}, updated ${updatedTotal}`,
    );
  }
  await client.query(
    `UPDATE tariff_import_state
     SET "ratedGeneration" = "rateGeneration"
     WHERE id = 1`,
  );
  console.log(
    `cdr tariff rate finished: scanned ${scannedTotal}, updated ${updatedTotal}`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
