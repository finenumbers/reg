-- Parking is a status, not a category. «Проверить» replaces the leftover «Ошибка».
-- Create the wider status function before the trigger calls it, then drop the old one.

CREATE FUNCTION cdr_call_status(
  elapsed_time text,
  side_a text,
  side_b text,
  dst_name text,
  src_name text,
  disconnect_code_string text,
  dp_name text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
SELECT CASE
    WHEN elapsed_time = '' THEN 'Неуспешные'
    WHEN dst_name = 'Service_Parking' AND (starts_with(src_name, 'Redirect_') OR dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ')) THEN 'Паркинг'
    WHEN dst_name = 'Service_Parking' AND (disconnect_code_string IN ('Class4, 1 - Unregistered IP Address', 'Class4, 40 - Gateway Is Invalid') OR (side_a IN ('', '-') AND side_b IN ('', '-'))) THEN 'Успешный'
    WHEN dst_name = 'Service_Parking' THEN 'Паркинг'
    ELSE 'Успешный'
  END
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
    NEW.dp_name,
    NEW.bill_ani,
    NEW.bill_dnis
  );
  NEW.call_status := cdr_call_status(
    NEW.elapsed_time,
    NEW.side_a,
    NEW.side_b,
    NEW.dst_name,
    NEW.src_name,
    NEW.disconnect_code_string,
    NEW.dp_name
  );

  IF TG_OP = 'INSERT' THEN
    SELECT r.direction, r.charge, r.price
    INTO NEW.tariff_direction, NEW.tariff_charge, NEW.tariff_price
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
    SELECT r.direction, r.charge, r.price
    INTO NEW.tariff_direction, NEW.tariff_charge, NEW.tariff_price
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

DROP FUNCTION cdr_call_status(text);

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
    WHEN starts_with(src_name, 'Redirect_') THEN 'Редирект'
    WHEN dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ') THEN 'Проверка'
    WHEN disconnect_code_string = 'Class4, 1 - Unregistered IP Address' THEN 'Нет регистрации'
    WHEN disconnect_code_string = 'Class4, 40 - Gateway Is Invalid' THEN 'Ошибка маршрута'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN 'Фантомный'
    WHEN side_a NOT IN ('', '-') AND cdr_call_geography(bill_ani, bill_dnis) = 'local' THEN 'Местный'
    WHEN side_a NOT IN ('', '-') AND cdr_call_geography(bill_ani, bill_dnis) = 'international' THEN 'Международный'
    WHEN side_a NOT IN ('', '-') THEN 'Междугородный'
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий'
    ELSE 'Проверить'
  END
$fn$;

CREATE OR REPLACE FUNCTION cdr_rate_call(
  category text,
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

  IF category = 'Местный' THEN
    direction := 'Местный звонок';
    RETURN;
  END IF;

  IF category NOT IN (
    'Междугородный',
    'Международный',
    'Редирект'
  ) OR (status IS DISTINCT FROM 'Успешный' AND status IS DISTINCT FROM 'Паркинг') THEN
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

  SELECT t.direction, t.price
  INTO v_dir, v_price
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

  IF abs(charge_k) >= 100000000000000 THEN
    RETURN;
  END IF;

  direction := v_dir;
  charge := cdr_kopecks_text(charge_k);
  price := cdr_tariff_price_text(v_price);
  RETURN;
END;
$fn$;
