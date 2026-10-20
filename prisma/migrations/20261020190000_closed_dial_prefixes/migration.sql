-- An outgoing B-number that starts with 0, 83, 89, 887, 889, or * is
-- «Ошибка» / «Проверить» unless an ABC that itself starts with that same
-- prefix is a prefix of the number and accepts the length.
-- A shorter foreign ABC does not cover it. A number on * is always a miss:
-- tariff ABC values are digits. This check is before the 10–15 digit window.
-- 880 and any other code stay on the previous rule.
-- Category and type CASE text already call this function and are not replaced.
-- Existing CDR rows are rewritten by scripts/cdr-tariff-backfill.mjs after this migration.
-- Do not drop this function: the insert trigger calls it through those CASE bodies.

CREATE OR REPLACE FUNCTION cdr_tariff_length_mismatch(bill_dnis text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN starts_with(b, '*')
      OR b ~ '^887'
      OR b ~ '^889'
      OR b ~ '^83'
      OR b ~ '^89'
      OR b ~ '^0'
    THEN NOT EXISTS (
      SELECT 1
      FROM tariff_rates AS t
      WHERE t.abc <> ''
        AND (
          (starts_with(b, '*') AND starts_with(t.abc, '*'))
          OR (b ~ '^887' AND starts_with(t.abc, '887'))
          OR (b ~ '^889' AND starts_with(t.abc, '889'))
          OR (b ~ '^83' AND starts_with(t.abc, '83'))
          OR (b ~ '^89' AND starts_with(t.abc, '89'))
          OR (b ~ '^0' AND starts_with(t.abc, '0'))
        )
        AND t.abc IN (
          left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
          left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
          left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
        )
        AND (
          t."digitLengths" IS NULL
          OR (
            t."digitLengths" <> ''
            AND length(b)::text = ANY(string_to_array(t."digitLengths", '/'))
          )
        )
    )
    ELSE
      b ~ '^[0-9]{10,15}$'
      AND NOT (b ~ '^7' AND length(b) <> 11)
      AND CASE
        WHEN b ~ '^7' THEN NOT EXISTS (
          SELECT 1
          FROM tariff_rates AS t
          WHERE t.abc <> ''
            AND t.abc ~ '^7'
            AND t.abc IN (
              left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
              left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
              left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
            )
        )
        ELSE (
          EXISTS (
            SELECT 1
            FROM tariff_rates AS t
            WHERE t.abc <> ''
              AND t.abc IN (
                left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
                left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
                left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM tariff_rates AS t
            WHERE t.abc <> ''
              AND t.abc IN (
                left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
                left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
                left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
              )
              AND (
                t."digitLengths" IS NULL
                OR (
                  t."digitLengths" <> ''
                  AND length(b)::text = ANY(string_to_array(t."digitLengths", '/'))
                )
              )
          )
        )
      END
  END
  FROM (SELECT btrim(bill_dnis) AS b) AS trimmed
$fn$;
