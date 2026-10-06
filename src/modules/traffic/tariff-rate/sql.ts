/**
 * One batch of the historical tariff pass.
 * scripts/cdr-tariff-backfill.mjs embeds this text. A test keeps them equal.
 * $1 is the previous id cursor ('' on the first batch). $2 is the batch size.
 */

export const CDR_TARIFF_BATCH_SQL = `
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
    r.price
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
    tariff_price = rated.price
  FROM rated
  WHERE c.id = rated.id
    AND (c.tariff_direction, c.tariff_charge, c.tariff_price)
      IS DISTINCT FROM (rated.direction, rated.charge, rated.price)
  RETURNING c.id
)
SELECT
  (SELECT b.id FROM batch AS b ORDER BY b.id DESC LIMIT 1) AS last_id,
  (SELECT count(*) FROM batch) AS scanned,
  (SELECT count(*) FROM updated) AS updated
`.trim();
