-- Tariff cells on raw CDR. Existing rows stay '' until
-- scripts/cdr-tariff-backfill.mjs. `npx prisma migrate deploy` alone
-- does not fill them.

ALTER TABLE "cdr_records" ADD COLUMN "tariff_direction" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "tariff_charge" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "tariff_cost" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "tariff_profit" TEXT NOT NULL DEFAULT '';

ALTER TABLE "tariff_import_state" ADD COLUMN "rateGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tariff_import_state" ADD COLUMN "ratedGeneration" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION cdr_kopecks_text(kopecks numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  k bigint;
  abs_k bigint;
  frac int;
BEGIN
  k := trunc(kopecks)::bigint;
  abs_k := abs(k);
  frac := (abs_k % 100)::int;
  RETURN CASE WHEN k < 0 THEN '-' ELSE '' END
    || (abs_k / 100)::text
    || '.'
    || lpad(frac::text, 2, '0');
END;
$fn$;

-- Longest ABC prefix. Price is per minute and billed in whole minutes.
-- Cost is per minute and billed by ceiled seconds / 60.
-- Both results CEIL to a kopeck toward +infinity.
CREATE FUNCTION cdr_rate_call(
  category text,
  status text,
  bill_dnis text,
  elapsed_time text,
  OUT direction text,
  OUT charge text,
  OUT cost text,
  OUT profit text
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

  IF category = 'Исходящий паркинг' THEN
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
  RETURN;
END;
$fn$;

CREATE OR REPLACE FUNCTION cdr_apply_call_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.call_category := cdr_call_category(
    NEW.side_a,
    NEW.side_b,
    NEW.dst_name,
    NEW.src_name,
    NEW.disconnect_code_string,
    NEW.dp_name
  );
  NEW.call_status := cdr_call_status(NEW.elapsed_time);

  IF TG_OP = 'INSERT' THEN
    SELECT r.direction, r.charge, r.cost, r.profit
    INTO NEW.tariff_direction, NEW.tariff_charge, NEW.tariff_cost, NEW.tariff_profit
    FROM cdr_rate_call(
      NEW.call_category,
      NEW.call_status,
      NEW.bill_dnis,
      NEW.elapsed_time
    ) AS r;
  ELSIF NEW.call_category IS DISTINCT FROM OLD.call_category
     OR NEW.call_status IS DISTINCT FROM OLD.call_status
     OR NEW.bill_dnis IS DISTINCT FROM OLD.bill_dnis
     OR NEW.elapsed_time IS DISTINCT FROM OLD.elapsed_time
  THEN
    SELECT r.direction, r.charge, r.cost, r.profit
    INTO NEW.tariff_direction, NEW.tariff_charge, NEW.tariff_cost, NEW.tariff_profit
    FROM cdr_rate_call(
      NEW.call_category,
      NEW.call_status,
      NEW.bill_dnis,
      NEW.elapsed_time
    ) AS r;
  END IF;

  RETURN NEW;
END;
$fn$;
