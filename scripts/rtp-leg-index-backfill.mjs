/**
 * Fill out_host, in_host, out_audio, in_audio, and cdr_date on
 * cdr_voipmonitor_links, then build the two partial indexes.
 * Host and audio use scripts/rtp-leg-index.mjs, the same rules as the screen.
 * Reads cdr_date by primary key. Does not update cdr_records.
 * Idempotent. Exits 0 only when the hosts are NOT NULL and both indexes exist.
 * The app must not start until this script exits 0.
 */
import pg from "pg";
import { pathToFileURL } from "node:url";
import { indexVoipmonitorLegs } from "./rtp-leg-index.mjs";

const BATCH = 2000;
const OUT_INDEX = "cdr_voipmonitor_links_out_absent_idx";
const IN_INDEX = "cdr_voipmonitor_links_in_absent_idx";

function audioText(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return null;
}

async function ready(client) {
  const { rows } = await client.query(
    `SELECT
       (SELECT attnotnull FROM pg_attribute
         WHERE attrelid = 'cdr_voipmonitor_links'::regclass
           AND attname = 'out_host' AND NOT attisdropped) AS host_not_null,
       (SELECT attnotnull FROM pg_attribute
         WHERE attrelid = 'cdr_voipmonitor_links'::regclass
           AND attname = 'in_host' AND NOT attisdropped) AS in_not_null,
       (SELECT attnotnull FROM pg_attribute
         WHERE attrelid = 'cdr_voipmonitor_links'::regclass
           AND attname = 'cdr_date' AND NOT attisdropped) AS date_not_null,
       EXISTS (SELECT 1 FROM pg_class WHERE relname = $1) AS out_idx,
       EXISTS (SELECT 1 FROM pg_class WHERE relname = $2) AS in_idx`,
    [OUT_INDEX, IN_INDEX],
  );
  const row = rows[0];
  return Boolean(
    row?.host_not_null &&
    row?.in_not_null &&
    row?.date_not_null &&
    row?.out_idx &&
    row?.in_idx,
  );
}

async function fill(client) {
  for (;;) {
    const selected = await client.query(
      `SELECT l.cdr_record_id, l.voipmonitor_legs, COALESCE(c.cdr_date, '') AS cdr_date
       FROM cdr_voipmonitor_links l
       LEFT JOIN cdr_records c ON c.id = l.cdr_record_id
       WHERE l.out_host IS NULL
       ORDER BY l.cdr_record_id
       LIMIT $1`,
      [BATCH],
    );
    if (selected.rows.length === 0) return;
    const payload = selected.rows.map((row) => {
      const indexed = indexVoipmonitorLegs(row.voipmonitor_legs);
      return {
        id: row.cdr_record_id,
        out_host: indexed.outHost,
        in_host: indexed.inHost,
        out_audio: audioText(indexed.outAudio),
        in_audio: audioText(indexed.inAudio),
        cdr_date: typeof row.cdr_date === "string" ? row.cdr_date : "",
      };
    });
    await client.query("BEGIN");
    try {
      const updated = await client.query(
        `UPDATE cdr_voipmonitor_links AS l
         SET out_host = v.out_host,
             in_host = v.in_host,
             out_audio = CASE v.out_audio
               WHEN 'true' THEN TRUE
               WHEN 'false' THEN FALSE
               ELSE NULL
             END,
             in_audio = CASE v.in_audio
               WHEN 'true' THEN TRUE
               WHEN 'false' THEN FALSE
               ELSE NULL
             END,
             cdr_date = v.cdr_date
         FROM jsonb_to_recordset($1::jsonb) AS v(
           id text,
           out_host text,
           in_host text,
           out_audio text,
           in_audio text,
           cdr_date text
         )
         WHERE l.cdr_record_id = v.id
           AND l.out_host IS NULL`,
        [JSON.stringify(payload)],
      );
      if (updated.rowCount !== selected.rows.length) {
        throw new Error("rtp leg index: a row was not filled");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`rtp leg index: filled ${selected.rows.length}`);
  }
}

async function constrain(client) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN out_host SET DEFAULT ''`,
    );
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN in_host SET DEFAULT ''`,
    );
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN cdr_date SET DEFAULT ''`,
    );
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN out_host SET NOT NULL`,
    );
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN in_host SET NOT NULL`,
    );
    await client.query(
      `ALTER TABLE cdr_voipmonitor_links ALTER COLUMN cdr_date SET NOT NULL`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function createIndexes(client) {
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${OUT_INDEX}
     ON cdr_voipmonitor_links (out_host, cdr_date)
     WHERE out_audio = false`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${IN_INDEX}
     ON cdr_voipmonitor_links (in_host, cdr_date)
     WHERE in_audio = false`,
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '15s'");
    if (await ready(client)) {
      console.log("rtp leg index: already filled");
      return;
    }
    await fill(client);
    const left = await client.query(
      `SELECT COUNT(*)::bigint AS count
       FROM cdr_voipmonitor_links
       WHERE out_host IS NULL OR in_host IS NULL OR cdr_date IS NULL`,
    );
    if (String(left.rows[0]?.count ?? "") !== "0") {
      throw new Error("rtp leg index: null hosts remain");
    }
    await constrain(client);
    await createIndexes(client);
    if (!(await ready(client))) {
      throw new Error("rtp leg index: indexes are missing");
    }
    console.log("rtp leg index: ready");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
