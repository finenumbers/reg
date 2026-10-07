/**
 * Recompute call_category and call_type from the current tariff snapshot, then fill
 * tariff_direction / tariff_charge / tariff_price.
 * Idempotent: a row is rewritten only when category, type, or the three cells change.
 * Compose migrator runs this after migrate deploy. The app must not start
 * until this script exits 0.
 *
 * The batch SQL is kept identical to src/modules/traffic/tariff-rate/sql.ts.
 */
import pg from "pg";

const BATCH = 5000;

const CDR_TARIFF_BATCH_SQL = `
WITH batch AS (
  SELECT
    c.id,
    c.side_a,
    c.side_b,
    c.dst_name,
    c.src_name,
    c.disconnect_code_string,
    c.dp_name,
    c.bill_ani,
    c.bill_dnis,
    c.call_status,
    c.elapsed_time
  FROM cdr_records AS c
  WHERE c.id > $1
  ORDER BY c.id
  LIMIT $2
),
classified AS (
  SELECT
    b.id,
    b.call_status,
    b.bill_dnis,
    b.elapsed_time,
    cdr_call_category(
      b.side_a,
      b.side_b,
      b.dst_name,
      b.src_name,
      b.disconnect_code_string,
      b.dp_name,
      b.bill_ani,
      b.bill_dnis
    ) AS new_category,
    cdr_call_type(
      b.side_a,
      b.side_b,
      b.dst_name,
      b.src_name,
      b.disconnect_code_string,
      b.dp_name,
      b.bill_ani,
      b.bill_dnis
    ) AS new_type
  FROM batch AS b
),
rated AS (
  SELECT
    c.id,
    c.new_category,
    c.new_type,
    r.direction,
    r.charge,
    r.price
  FROM classified AS c
  CROSS JOIN LATERAL cdr_rate_call(
    c.new_category,
    c.new_type,
    c.call_status,
    c.bill_dnis,
    c.elapsed_time
  ) AS r
),
updated AS (
  UPDATE cdr_records AS u
  SET
    call_category = rated.new_category,
    call_type = rated.new_type,
    tariff_direction = rated.direction,
    tariff_charge = rated.charge,
    tariff_price = rated.price
  FROM rated
  WHERE u.id = rated.id
    AND (u.call_category, u.call_type, u.tariff_direction, u.tariff_charge, u.tariff_price)
      IS DISTINCT FROM (rated.new_category, rated.new_type, rated.direction, rated.charge, rated.price)
  RETURNING u.id
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
