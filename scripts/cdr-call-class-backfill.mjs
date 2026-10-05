/**
 * After prisma migrate deploy:
 * 1. Replace stored «Нет в биллинге» with «-» on both sides.
 * 2. Fill call_category / call_status left empty by the first migration.
 * 3. Reclassify rows that match the extra category predicates.
 *
 * Idempotent. A partial index exists only while old billing-miss rows remain.
 * Compose migrator runs this after migrate deploy. The app must not start
 * until this script exits 0.
 */
import pg from "pg";

const BATCH = 5000;
const EMPTY_INDEX = "cdr_records_call_category_empty_idx";
const MISS_INDEX = "cdr_records_billing_miss_idx";
const OLD_BILLING = "Нет в биллинге";
const CATEGORY_FN = `cdr_call_category(side_a, side_b, dst_name, src_name, disconnect_code_string)`;
const EXTRA_PREDICATE = `
  starts_with(src_name, 'Redirect_')
  OR dst_name = 'Service_Check'
  OR disconnect_code_string IN (
    'Class4, 1 - Unregistered IP Address',
    'Class4, 40 - Gateway Is Invalid'
  )
`;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function dropIndex(name) {
  await client.query(`DROP INDEX IF EXISTS ${name}`);
}

async function batchUntilDone({ label, previewSql, updateSql, stillSql }) {
  for (;;) {
    const preview = await client.query(previewSql);
    if (preview.rowCount === 0) return;

    const firstId = preview.rows[0].id;
    await client.query("BEGIN");
    try {
      const updated = await client.query(updateSql, [BATCH]);
      await client.query("COMMIT");
      const touched = updated.rowCount ?? 0;
      if (touched === 0) {
        throw new Error(`${label} updated no rows`);
      }
      const still = await client.query(stillSql, [firstId]);
      if ((still.rowCount ?? 0) > 0) {
        throw new Error(`${label} left ${firstId} unchanged`);
      }
      console.log(`${label}: updated ${touched}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function replaceBillingMiss() {
  const pending = await client.query(
    `SELECT 1 FROM cdr_records
     WHERE side_a = $1 OR side_b = $1
     LIMIT 1`,
    [OLD_BILLING],
  );
  if ((pending.rowCount ?? 0) === 0) {
    await dropIndex(MISS_INDEX);
    console.log("cdr billing miss backfill: nothing to replace");
    return;
  }

  await client.query(`
    CREATE INDEX IF NOT EXISTS ${MISS_INDEX}
    ON cdr_records (id)
    WHERE side_a = 'Нет в биллинге' OR side_b = 'Нет в биллинге'
  `);
  await batchUntilDone({
    label: "cdr billing miss backfill",
    previewSql: `
      SELECT id FROM cdr_records
      WHERE side_a = 'Нет в биллинге' OR side_b = 'Нет в биллинге'
      ORDER BY id
      LIMIT 1
    `,
    updateSql: `
      UPDATE cdr_records
      SET side_a = CASE WHEN side_a = 'Нет в биллинге' THEN '-' ELSE side_a END,
          side_b = CASE WHEN side_b = 'Нет в биллинге' THEN '-' ELSE side_b END
      WHERE id IN (
        SELECT id FROM cdr_records
        WHERE side_a = 'Нет в биллинге' OR side_b = 'Нет в биллинге'
        ORDER BY id
        LIMIT $1
      )
    `,
    stillSql: `
      SELECT 1 FROM cdr_records
      WHERE id = $1
        AND (side_a = 'Нет в биллинге' OR side_b = 'Нет в биллинге')
    `,
  });
  await dropIndex(MISS_INDEX);
  console.log("cdr billing miss backfill: complete");
}

async function fillEmptyCategories() {
  const pending = await client.query(
    `SELECT 1 FROM cdr_records WHERE call_category = '' LIMIT 1`,
  );
  if ((pending.rowCount ?? 0) === 0) {
    await dropIndex(EMPTY_INDEX);
    console.log("cdr call class backfill: nothing to fill");
    return;
  }

  await client.query(`
    CREATE INDEX IF NOT EXISTS ${EMPTY_INDEX}
    ON cdr_records (id)
    WHERE call_category = ''
  `);
  await batchUntilDone({
    label: "cdr call class backfill",
    previewSql: `
      SELECT id FROM cdr_records
      WHERE call_category = ''
      ORDER BY id
      LIMIT 1
    `,
    updateSql: `
      UPDATE cdr_records
      SET call_category = ${CATEGORY_FN},
          call_status = cdr_call_status(elapsed_time)
      WHERE id IN (
        SELECT id FROM cdr_records
        WHERE call_category = ''
        ORDER BY id
        LIMIT $1
      )
    `,
    stillSql: `
      SELECT 1 FROM cdr_records
      WHERE id = $1 AND call_category = ''
    `,
  });
  await dropIndex(EMPTY_INDEX);
  console.log("cdr call class backfill: complete");
}

async function reclassifyExtra() {
  await batchUntilDone({
    label: "cdr call class reclassify",
    previewSql: `
      SELECT id FROM cdr_records
      WHERE (${EXTRA_PREDICATE})
        AND call_category IS DISTINCT FROM ${CATEGORY_FN}
      ORDER BY id
      LIMIT 1
    `,
    updateSql: `
      UPDATE cdr_records
      SET call_category = ${CATEGORY_FN}
      WHERE id IN (
        SELECT id FROM cdr_records
        WHERE (${EXTRA_PREDICATE})
          AND call_category IS DISTINCT FROM ${CATEGORY_FN}
        ORDER BY id
        LIMIT $1
      )
    `,
    stillSql: `
      SELECT 1 FROM cdr_records
      WHERE id = $1
        AND (${EXTRA_PREDICATE})
        AND call_category IS DISTINCT FROM ${CATEGORY_FN}
    `,
  });
  console.log("cdr call class reclassify: complete");
}

try {
  await client.connect();
  await replaceBillingMiss();
  await fillEmptyCategories();
  await reclassifyExtra();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
