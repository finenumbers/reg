-- Digit length on a tariff ABC. Russian 73/74/78/79 always matches 11 digits.
-- Any other ABC matches digitLength, or any admitted length when the cell is empty.
-- An admitted number is the same set the category function does not call malformed:
-- 10 to 15 digits, and a number that starts with 7 is exactly 11.
-- Existing CDR rows are rewritten by scripts/cdr-tariff-backfill.mjs after this migration.
-- Do not drop these functions: the insert trigger calls cdr_rate_call.

ALTER TABLE "tariff_rates" ADD COLUMN "digitLength" INTEGER;

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
      (t.abc ~ '^(73|74|78|79)' AND length(btrim(number)) = 11)
      OR (
        t.abc !~ '^(73|74|78|79)'
        AND (t."digitLength" IS NULL OR length(btrim(number)) = t."digitLength")
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
      (t.abc ~ '^(73|74|78|79)' AND length(b) = 11)
      OR (
        t.abc !~ '^(73|74|78|79)'
        AND (t."digitLength" IS NULL OR length(b) = t."digitLength")
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
