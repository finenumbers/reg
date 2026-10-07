/**
 * One batch of the historical tariff pass.
 * scripts/cdr-tariff-backfill.mjs embeds this text. A test keeps them equal.
 * $1 is the previous id cursor ('' on the first batch). $2 is the batch size.
 * Category is recomputed because local versus intercity follows the tariff snapshot.
 */

export const CDR_TARIFF_BATCH_SQL = `
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
    ) AS new_category
  FROM batch AS b
),
rated AS (
  SELECT
    c.id,
    c.new_category,
    r.direction,
    r.charge,
    r.price
  FROM classified AS c
  CROSS JOIN LATERAL cdr_rate_call(
    c.new_category,
    c.call_status,
    c.bill_dnis,
    c.elapsed_time
  ) AS r
),
updated AS (
  UPDATE cdr_records AS u
  SET
    call_category = rated.new_category,
    tariff_direction = rated.direction,
    tariff_charge = rated.charge,
    tariff_price = rated.price
  FROM rated
  WHERE u.id = rated.id
    AND (u.call_category, u.tariff_direction, u.tariff_charge, u.tariff_price)
      IS DISTINCT FROM (rated.new_category, rated.direction, rated.charge, rated.price)
  RETURNING u.id
)
SELECT
  (SELECT b.id FROM batch AS b ORDER BY b.id DESC LIMIT 1) AS last_id,
  (SELECT count(*) FROM batch) AS scanned,
  (SELECT count(*) FROM updated) AS updated
`.trim();
