-- ABC of the same tariff row as cdr_tariff_direction.
-- The predicate below stays identical to that function. The parity test reads both.
-- Geography calls both in one statement. The CDR trigger does not call this function.
-- No stored rows change. The rater and the direction function stay as they are.

CREATE FUNCTION cdr_tariff_abc(number text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT t.abc
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
