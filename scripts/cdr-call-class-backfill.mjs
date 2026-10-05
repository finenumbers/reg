/**
 * Fill call_category / call_status on CDR rows left empty by the migration.
 * Compose migrator runs this after `prisma migrate deploy`. Idempotent.
 *
 * A partial index exists only while blanks remain, so the batch loop does not
 * scan the whole table on every page. It is dropped when the table is clean
 * so the database matches schema.prisma.
 */
import pg from "pg";

const BATCH = 5000;
const INDEX = "cdr_records_call_category_empty_idx";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function dropIndex() {
  await client.query(`DROP INDEX IF EXISTS ${INDEX}`);
}

async function ensureIndex() {
  await client.query(`
    CREATE INDEX IF NOT EXISTS ${INDEX}
    ON cdr_records (id)
    WHERE call_category = ''
  `);
}

async function fill() {
  for (;;) {
    const preview = await client.query(
      `SELECT id FROM cdr_records WHERE call_category = '' ORDER BY id LIMIT 1`,
    );
    if (preview.rowCount === 0) return;

    const firstId = preview.rows[0].id;
    await client.query("BEGIN");
    try {
      const updated = await client.query(
        `
          UPDATE cdr_records
          SET call_category = cdr_call_category(side_a, side_b, dst_name),
              call_status = cdr_call_status(elapsed_time)
          WHERE id IN (
            SELECT id FROM cdr_records
            WHERE call_category = ''
            ORDER BY id
            LIMIT $1
          )
        `,
        [BATCH],
      );
      await client.query("COMMIT");
      const touched = updated.rowCount ?? 0;
      if (touched === 0) {
        throw new Error("cdr call class backfill updated no rows");
      }
      const still = await client.query(
        `SELECT 1 FROM cdr_records WHERE id = $1 AND call_category = ''`,
        [firstId],
      );
      if ((still.rowCount ?? 0) > 0) {
        throw new Error(
          `cdr call class backfill left ${firstId} unclassified`,
        );
      }
      console.log(`cdr call class backfill: updated ${touched}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

try {
  await client.connect();
  const pending = await client.query(
    `SELECT 1 FROM cdr_records WHERE call_category = '' LIMIT 1`,
  );
  if ((pending.rowCount ?? 0) === 0) {
    await dropIndex();
    console.log("cdr call class backfill: nothing to fill");
  } else {
    await ensureIndex();
    await fill();
    await dropIndex();
    console.log("cdr call class backfill: complete");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
