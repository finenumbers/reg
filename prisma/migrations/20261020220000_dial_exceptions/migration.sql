-- Digit ABC codes that mark an uncovered outgoing B-number as
-- «Ошибка» / «Проверить». * and # are not rows: any occurrence is a miss
-- before this table is read. The longest matching ABC wins, so ABC 89 does
-- not cover a number on 889. A tariff ABC that starts with 7 still requires
-- 11 digits. Category and type CASE text already call this function.
-- rateGeneration moves ahead of ratedGeneration. The app job rewrites stored
-- rows after migrate exits. Do not equate the two generations here.

CREATE TABLE "dial_exceptions" (
    "abc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dial_exceptions_pkey" PRIMARY KEY ("abc"),
    CONSTRAINT "dial_exceptions_abc_digits" CHECK ("abc" ~ '^[0-9]{1,15}$')
);

INSERT INTO "dial_exceptions" ("abc") VALUES
    ('0'),
    ('83'),
    ('89'),
    ('887'),
    ('889');

CREATE OR REPLACE FUNCTION cdr_tariff_length_mismatch(bill_dnis text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN b ~ '[*#]' THEN true
    WHEN EXISTS (
      SELECT 1
      FROM dial_exceptions AS e
      WHERE starts_with(b, e.abc)
    ) THEN NOT EXISTS (
      SELECT 1
      FROM tariff_rates AS t
      WHERE t.abc <> ''
        AND starts_with(
          t.abc,
          (
            SELECT e.abc
            FROM dial_exceptions AS e
            WHERE starts_with(b, e.abc)
            ORDER BY length(e.abc) DESC
            LIMIT 1
          )
        )
        AND t.abc IN (
          left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
          left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
          left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
        )
        AND (
          (
            t.abc ~ '^7'
            AND length(b) = 11
          )
          OR (
            t.abc !~ '^7'
            AND (
              t."digitLengths" IS NULL
              OR (
                t."digitLengths" <> ''
                AND length(b)::text = ANY(string_to_array(t."digitLengths", '/'))
              )
            )
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

INSERT INTO "tariff_import_state" (
    "id",
    "rowCount",
    "rateGeneration",
    "ratedGeneration",
    "updatedAt"
)
VALUES (1, 0, 1, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "rateGeneration" = "tariff_import_state"."rateGeneration" + 1,
    "updatedAt" = CURRENT_TIMESTAMP;
