-- An ABC that starts with 7 always matches 11 digits. The length cell is ignored.
-- Any other ABC matches one of the lengths in digitLengths ("12" or "12/13"),
-- or any admitted length when that text is null.
-- An empty string matches nothing. Do not store one.
-- Prisma cannot store a nullable integer array, so the list is text.
-- An admitted number is 10 to 15 digits, and a number that starts with 7 is exactly 11.
-- A known outgoing B-number is «Ошибка» / «Проверить» when a 7-number has no ABC on 7,
-- or when some other prefix exists and none of those rows accept the length.
-- Existing CDR rows are rewritten by scripts/cdr-tariff-backfill.mjs after this migration.
-- Do not drop these functions: the insert trigger calls them.
-- Replace the functions before dropping digitLength. The old bodies depend on that column.

ALTER TABLE "tariff_rates" ADD COLUMN "digitLengths" TEXT;

UPDATE "tariff_rates"
SET "digitLengths" = "digitLength"::text
WHERE "digitLength" IS NOT NULL;

CREATE OR REPLACE FUNCTION cdr_tariff_direction(number text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT t.direction
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

CREATE OR REPLACE FUNCTION cdr_rate_call(
  category text,
  call_type text,
  status text,
  bill_dnis text,
  elapsed_time text,
  OUT direction text,
  OUT charge text,
  OUT price text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  b text;
  ms numeric;
  seconds numeric;
  minutes numeric;
  v_dir text;
  v_price numeric;
  price6 numeric;
  charge_k numeric;
  charge_num numeric;
BEGIN
  direction := '';
  charge := '';
  price := '';

  IF category IS DISTINCT FROM 'Исходящий' THEN
    RETURN;
  END IF;

  b := btrim(bill_dnis);
  IF b !~ '^[0-9]{10,15}$' OR (b ~ '^7' AND length(b) <> 11) THEN
    RETURN;
  END IF;

  SELECT t.direction, t.price
  INTO v_dir, v_price
  FROM tariff_rates AS t
  WHERE t.abc <> ''
    AND t.abc IN (
      left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
      left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
      left(b, 11), left(b, 12), left(b, 13), left(b, 14), left(b, 15)
    )
    AND (
      (t.abc ~ '^7' AND length(b) = 11)
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
  ORDER BY length(t.abc) DESC, t."sortIndex" ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  direction := v_dir;

  IF status IS DISTINCT FROM 'Успешный' AND status IS DISTINCT FROM 'Паркинг' THEN
    RETURN;
  END IF;

  IF call_type = 'Местный' THEN
    RETURN;
  END IF;

  IF call_type NOT IN ('Междугородный', 'Международный', 'Мобильный', 'Редирект') THEN
    RETURN;
  END IF;

  IF btrim(elapsed_time) ~ '^[0-9]+([.,][0-9]+)?$' THEN
    ms := replace(btrim(elapsed_time), ',', '.')::numeric;
  ELSE
    ms := 0;
  END IF;
  IF ms < 0 THEN
    ms := 0;
  END IF;
  seconds := ceil(ms / 1000);
  IF seconds <= 3 THEN
    minutes := 0;
  ELSE
    minutes := ceil(seconds / 60);
  END IF;

  price6 := trunc(v_price * 1000000);
  charge_num := minutes * price6;
  charge_k := CASE
    WHEN charge_num > 0 THEN div(charge_num + 9999, 10000)
    WHEN charge_num < 0 THEN div(charge_num, 10000)
    ELSE 0
  END;

  IF abs(charge_k) >= 100000000000000 THEN
    RETURN;
  END IF;

  charge := cdr_kopecks_text(charge_k);
  price := cdr_tariff_price_text(v_price);
  RETURN;
END;
$fn$;

CREATE OR REPLACE FUNCTION cdr_tariff_length_mismatch(bill_dnis text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT
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
  FROM (SELECT btrim(bill_dnis) AS b) AS trimmed
$fn$;

CREATE OR REPLACE FUNCTION cdr_call_category(
  side_a text,
  side_b text,
  dst_name text,
  src_name text,
  disconnect_code_string text,
  dp_name text,
  bill_ani text,
  bill_dnis text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
SELECT CASE
    WHEN disconnect_code_string = 'Class4, 1 - Unregistered IP Address' THEN 'Ошибка'
    WHEN disconnect_code_string = 'Class4, 40 - Gateway Is Invalid' THEN 'Ошибка'
    WHEN disconnect_code_string = 'Class4, 4 - Originator Capacity Exceeded' THEN 'Ошибка'
    WHEN disconnect_code_string = 'Class4, 5 - Terminator Capacity Exceeded' THEN 'Ошибка'
    WHEN starts_with(src_name, 'Redirect_') THEN 'Исходящий'
    WHEN dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ') THEN 'Проверка'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN 'Фантомный'
    WHEN side_a NOT IN ('', '-') AND ((btrim(bill_dnis) ~ '^7' AND btrim(bill_dnis) !~ '^[0-9]{11}$') OR (btrim(bill_dnis) ~ '^[0-9]*$' AND length(btrim(bill_dnis)) < 10) OR (btrim(bill_dnis) ~ '^[0-9]+$' AND length(btrim(bill_dnis)) > 15)) THEN 'Ошибка'
    WHEN side_a NOT IN ('', '-') AND cdr_tariff_length_mismatch(bill_dnis) THEN 'Ошибка'
    WHEN side_a NOT IN ('', '-') THEN 'Исходящий'
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий'
    ELSE 'Ошибка'
  END
$fn$;

CREATE OR REPLACE FUNCTION cdr_call_type(
  side_a text,
  side_b text,
  dst_name text,
  src_name text,
  disconnect_code_string text,
  dp_name text,
  bill_ani text,
  bill_dnis text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
SELECT CASE
    WHEN disconnect_code_string = 'Class4, 1 - Unregistered IP Address' THEN 'Нет регистрации'
    WHEN disconnect_code_string = 'Class4, 40 - Gateway Is Invalid' THEN 'Ошибка маршрута'
    WHEN disconnect_code_string = 'Class4, 4 - Originator Capacity Exceeded' THEN 'Канальность'
    WHEN disconnect_code_string = 'Class4, 5 - Terminator Capacity Exceeded' THEN 'Канальность'
    WHEN starts_with(src_name, 'Redirect_') THEN 'Редирект'
    WHEN dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ') THEN 'Проверка'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN CASE cdr_call_geography(bill_ani, bill_dnis, 'incoming')
      WHEN 'local' THEN 'Местный'
      WHEN 'mobile' THEN 'Мобильный'
      WHEN 'international' THEN 'Международный'
      ELSE 'Междугородный'
    END
    WHEN side_a NOT IN ('', '-') AND ((btrim(bill_dnis) ~ '^7' AND btrim(bill_dnis) !~ '^[0-9]{11}$') OR (btrim(bill_dnis) ~ '^[0-9]*$' AND length(btrim(bill_dnis)) < 10) OR (btrim(bill_dnis) ~ '^[0-9]+$' AND length(btrim(bill_dnis)) > 15)) THEN 'Проверить'
    WHEN side_a NOT IN ('', '-') AND cdr_tariff_length_mismatch(bill_dnis) THEN 'Проверить'
    WHEN side_a NOT IN ('', '-') THEN CASE cdr_call_geography(bill_ani, bill_dnis, 'outgoing')
      WHEN 'local' THEN 'Местный'
      WHEN 'mobile' THEN 'Мобильный'
      WHEN 'international' THEN 'Международный'
      ELSE 'Междугородный'
    END
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN CASE cdr_call_geography(bill_ani, bill_dnis, 'incoming')
      WHEN 'local' THEN 'Местный'
      WHEN 'mobile' THEN 'Мобильный'
      WHEN 'international' THEN 'Международный'
      ELSE 'Междугородный'
    END
    ELSE 'Проверить'
  END
$fn$;

ALTER TABLE "tariff_rates" DROP COLUMN "digitLength";
