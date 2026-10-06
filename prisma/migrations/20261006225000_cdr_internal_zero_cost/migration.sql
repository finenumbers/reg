-- Successful «Внутренний звонок» writes cost 0.00, same as «Исходящий паркинг».
-- Existing rows stay until scripts/cdr-tariff-backfill.mjs.

CREATE OR REPLACE FUNCTION cdr_rate_call(
  category text,
  status text,
  bill_dnis text,
  elapsed_time text,
  OUT direction text,
  OUT charge text,
  OUT cost text,
  OUT profit text,
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
  v_cost numeric;
  price6 numeric;
  cost6 numeric;
  charge_k numeric;
  cost_k numeric;
  profit_k numeric;
  charge_num numeric;
BEGIN
  direction := '';
  charge := '';
  cost := '';
  profit := '';
  price := '';

  IF category NOT IN (
    'Исходящий звонок',
    'Внутренний звонок',
    'Редирект',
    'Исходящий паркинг'
  ) OR status IS DISTINCT FROM 'Успешный' THEN
    RETURN;
  END IF;

  b := btrim(bill_dnis);
  IF b !~ '^7[0-9]{10}$' THEN
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
  minutes := ceil(seconds / 60);

  SELECT t.direction, t.price, t.cost
  INTO v_dir, v_price, v_cost
  FROM tariff_rates AS t
  WHERE t.abc IN (
    left(b, 1), left(b, 2), left(b, 3), left(b, 4), left(b, 5),
    left(b, 6), left(b, 7), left(b, 8), left(b, 9), left(b, 10),
    left(b, 11)
  )
  ORDER BY length(t.abc) DESC, t."sortIndex" ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  price6 := trunc(v_price * 1000000);
  charge_num := minutes * price6;
  charge_k := CASE
    WHEN charge_num > 0 THEN div(charge_num + 9999, 10000)
    WHEN charge_num < 0 THEN div(charge_num, 10000)
    ELSE 0
  END;

  IF category IN ('Исходящий паркинг', 'Внутренний звонок') THEN
    cost_k := 0;
  ELSE
    cost6 := trunc(v_cost * 1000000);
    cost_k := CASE
      WHEN seconds * cost6 > 0 THEN div(seconds * cost6 + 599999, 600000)
      WHEN seconds * cost6 < 0 THEN div(seconds * cost6, 600000)
      ELSE 0
    END;
  END IF;

  profit_k := charge_k - cost_k;

  IF abs(charge_k) >= 100000000000000
     OR abs(cost_k) >= 100000000000000
     OR abs(profit_k) >= 100000000000000 THEN
    RETURN;
  END IF;

  direction := v_dir;
  charge := cdr_kopecks_text(charge_k);
  cost := cdr_kopecks_text(cost_k);
  profit := cdr_kopecks_text(profit_k);
  price := cdr_tariff_price_text(v_price);
  RETURN;
END;
$fn$;
