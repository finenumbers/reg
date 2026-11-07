-- Region is display text. Numbering already on the row decides the screen split.
-- Neither column is read by the rater. This migration does not replace
-- cdr_tariff_direction, cdr_tariff_abc, cdr_rate_call, or the CDR trigger,
-- and it does not rewrite stored rows.
-- cdr_tariff_geo returns the same row the direction function would.
-- The FROM clause below stays identical to that function. The parity test reads both.
-- Geography is the only caller. It calls the function once, after the page limit
-- when no catalog filter is on, then geography_digit_split trims the screen ABC.
-- The split only removes a suffix of the tariff ABC. It never takes digits from
-- the phone that are not already in that ABC. Several applicable numbering
-- values leave the tariff ABC unchanged.

ALTER TABLE "tariff_rates" ADD COLUMN "region" TEXT;

CREATE FUNCTION cdr_tariff_geo(number text)
RETURNS TABLE(direction text, abc text, region text, numbering text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT t.direction, t.abc, t.region, t.numbering
  FROM tariff_rates AS t
  WHERE t.abc <> ''
    AND btrim(number) ~ '^[0-9]{10,15}$'
    AND NOT (btrim(number) ~ '^7' AND length(btrim(number)) <> 11)
    AND t.abc IN (
      left(btrim(number), 1), left(btrim(number), 2), left(btrim(number), 3),
      left(btrim(number), 4), left(btrim(number), 5), left(btrim(number), 6),
      left(btrim(number), 7), left(btrim(number), 8), left(btrim(number), 9),
      left(btrim(number), 10), left(btrim(number), 11), left(btrim(number), 12),
      left(btrim(number), 13), left(btrim(number), 14), left(btrim(number), 15)
    )
    AND (
      (t.abc ~ '^7' AND length(btrim(number)) = 11)
      OR (
        t.abc !~ '^7'
        AND (
          t."digitLengths" IS NULL
          OR (
            t."digitLengths" <> ''
            AND length(btrim(number))::text = ANY(string_to_array(t."digitLengths", '/'))
          )
        )
      )
    )
  ORDER BY length(t.abc) DESC, t."sortIndex" ASC
  LIMIT 1
$fn$;

CREATE FUNCTION geography_digit_split(tariff_abc text, numbering text, raw_number text)
RETURNS TABLE(abc text, telephone text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH trimmed AS (
    SELECT btrim(raw_number) AS number
  ),
  applicable AS (
    SELECT length(tariff_abc) + parsed.digits - length(trimmed.number) AS overlap
    FROM trimmed
    CROSS JOIN LATERAL (
      SELECT part::int AS digits
      FROM unnest(string_to_array(COALESCE(numbering, ''), '/')) AS u(part)
      WHERE part ~ '^(0|[1-9]|1[0-4])$'
    ) AS parsed
    WHERE tariff_abc IS NOT NULL
      AND tariff_abc <> ''
      AND trimmed.number IS NOT NULL
      AND starts_with(trimmed.number, tariff_abc)
      AND parsed.digits >= 1
      AND parsed.digits < length(trimmed.number)
      AND length(tariff_abc) + parsed.digits - length(trimmed.number) > 0
      AND length(tariff_abc) + parsed.digits - length(trimmed.number) < length(tariff_abc)
  ),
  chosen AS (
    SELECT CASE WHEN count(*) = 1 THEN min(overlap) END AS overlap
    FROM applicable
  )
  SELECT
    COALESCE(
      CASE
        WHEN tariff_abc IS NULL OR tariff_abc = '' THEN ''
        WHEN trimmed.number IS NULL OR NOT starts_with(trimmed.number, tariff_abc) THEN tariff_abc
        WHEN chosen.overlap IS NULL THEN tariff_abc
        ELSE left(tariff_abc, length(tariff_abc) - chosen.overlap)
      END,
      ''
    ),
    COALESCE(
      CASE
        WHEN tariff_abc IS NULL OR tariff_abc = '' THEN ''
        WHEN trimmed.number IS NULL OR NOT starts_with(trimmed.number, tariff_abc) THEN ''
        WHEN chosen.overlap IS NULL THEN substring(trimmed.number FROM length(tariff_abc) + 1)
        ELSE substring(trimmed.number FROM length(tariff_abc) - chosen.overlap + 1)
      END,
      ''
    )
  FROM trimmed
  CROSS JOIN chosen
$fn$;
