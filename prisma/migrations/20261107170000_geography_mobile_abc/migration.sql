-- A tariff ABC that starts with 79 is only the routing prefix.
-- When exactly one numbering value is shorter than the zone, the screen
-- ABC is the national code after the leading 7, and «Номер» is the last n digits.
-- The slice length is length(number) - n - 1. A length of length(number) - n
-- would keep one subscriber digit in the ABC.
-- One positive overlap still strips a suffix of the tariff ABC and wins
-- even when another list value is short.
-- This replace does not touch cdr_tariff_direction, cdr_tariff_abc,
-- cdr_rate_call, or stored rows.

CREATE OR REPLACE FUNCTION geography_digit_split(tariff_abc text, numbering text, raw_number text)
RETURNS TABLE(abc text, telephone text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH trimmed AS (
    SELECT btrim(raw_number) AS number
  ),
  parts AS (
    SELECT
      parsed.digits AS n,
      length(tariff_abc) + parsed.digits - length(trimmed.number) AS overlap
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
  ),
  positive AS (
    SELECT overlap
    FROM parts
    WHERE overlap > 0
      AND overlap < length(tariff_abc)
  ),
  chosen AS (
    SELECT
      count(*) AS positive_count,
      CASE WHEN count(*) = 1 THEN min(overlap) END AS overlap
    FROM positive
  ),
  short AS (
    SELECT parts.n
    FROM parts
    CROSS JOIN trimmed
    WHERE parts.overlap < 0
      AND trimmed.number ~ '^7[0-9]{10}$'
      AND tariff_abc ~ '^79'
      AND length(trimmed.number) - parts.n - 1 >= 1
      AND starts_with(
        substring(trimmed.number FROM 2 FOR length(trimmed.number) - parts.n - 1),
        substring(tariff_abc FROM 2)
      )
  ),
  picked AS (
    SELECT CASE WHEN count(*) = 1 THEN min(n) END AS n
    FROM short
  )
  SELECT
    COALESCE(
      CASE
        WHEN tariff_abc IS NULL OR tariff_abc = '' THEN ''
        WHEN trimmed.number IS NULL OR NOT starts_with(trimmed.number, tariff_abc) THEN tariff_abc
        WHEN chosen.positive_count = 1
          THEN left(tariff_abc, length(tariff_abc) - chosen.overlap)
        WHEN chosen.positive_count = 0 AND picked.n IS NOT NULL
          THEN substring(trimmed.number FROM 2 FOR length(trimmed.number) - picked.n - 1)
        ELSE tariff_abc
      END,
      ''
    ),
    COALESCE(
      CASE
        WHEN tariff_abc IS NULL OR tariff_abc = '' THEN ''
        WHEN trimmed.number IS NULL OR NOT starts_with(trimmed.number, tariff_abc) THEN ''
        WHEN chosen.positive_count = 1
          THEN substring(trimmed.number FROM length(tariff_abc) - chosen.overlap + 1)
        WHEN chosen.positive_count = 0 AND picked.n IS NOT NULL
          THEN substring(trimmed.number FROM length(trimmed.number) - picked.n + 1)
        ELSE substring(trimmed.number FROM length(tariff_abc) + 1)
      END,
      ''
    )
  FROM trimmed
  CROSS JOIN chosen
  CROSS JOIN picked
$fn$;
