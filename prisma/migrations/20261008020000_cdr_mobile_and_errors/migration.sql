-- Mobile type, one «Ошибки» category, and parking status on exact Service_Parking.
-- The v1.92.0 rater stays as shipped. Do not drop these functions: the insert trigger calls them.

CREATE OR REPLACE FUNCTION cdr_call_geography(bill_ani text, bill_dnis text, vector text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  ani text := btrim(bill_ani);
  dnis text := btrim(bill_dnis);
  far text;
  dir_a text;
  dir_b text;
BEGIN
  far := CASE WHEN vector = 'incoming' THEN ani ELSE dnis END;
  IF ani ~ '^(73|74|78)[0-9]{9}$' AND dnis ~ '^(73|74|78)[0-9]{9}$' THEN
    dir_a := cdr_tariff_direction(ani);
    dir_b := cdr_tariff_direction(dnis);
    IF dir_a IS NOT NULL AND dir_a = dir_b AND starts_with(dir_a, 'г. ') THEN
      RETURN 'local';
    END IF;
  END IF;
  IF far ~ '^79[0-9]{9}$' THEN
    RETURN 'mobile';
  END IF;
  IF far !~ '^(73|74|78)[0-9]{9}$' THEN
    RETURN 'international';
  END IF;
  RETURN 'intercity';
END;
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
    WHEN disconnect_code_string = 'Class4, 1 - Unregistered IP Address' THEN 'Ошибки'
    WHEN disconnect_code_string = 'Class4, 40 - Gateway Is Invalid' THEN 'Ошибки'
    WHEN disconnect_code_string = 'Class4, 4 - Originator Capacity Exceeded' THEN 'Ошибки'
    WHEN starts_with(src_name, 'Redirect_') THEN 'Исходящие'
    WHEN dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ') THEN 'Проверка'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN 'Фантомный'
    WHEN side_a NOT IN ('', '-') AND ((btrim(bill_dnis) ~ '^7' AND btrim(bill_dnis) !~ '^[0-9]{11}$') OR (btrim(bill_dnis) ~ '^[0-9]*$' AND length(btrim(bill_dnis)) < 10) OR (btrim(bill_dnis) ~ '^[0-9]+$' AND length(btrim(bill_dnis)) > 15)) THEN 'Ошибки'
    WHEN side_a NOT IN ('', '-') THEN 'Исходящие'
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий'
    ELSE 'Ошибки'
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
    WHEN starts_with(src_name, 'Redirect_') THEN 'Редирект'
    WHEN dp_name = 'Service_Check' OR starts_with(side_a, 'Тест ') OR starts_with(side_b, 'Тест ') THEN 'Проверка'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN CASE cdr_call_geography(bill_ani, bill_dnis, 'incoming')
      WHEN 'local' THEN 'Местный'
      WHEN 'mobile' THEN 'Мобильный'
      WHEN 'international' THEN 'Международный'
      ELSE 'Междугородный'
    END
    WHEN side_a NOT IN ('', '-') AND ((btrim(bill_dnis) ~ '^7' AND btrim(bill_dnis) !~ '^[0-9]{11}$') OR (btrim(bill_dnis) ~ '^[0-9]*$' AND length(btrim(bill_dnis)) < 10) OR (btrim(bill_dnis) ~ '^[0-9]+$' AND length(btrim(bill_dnis)) > 15)) THEN 'Проверить'
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

CREATE OR REPLACE FUNCTION cdr_call_status(
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
    WHEN elapsed_time = '' THEN 'Неуспешный'
    WHEN dst_name = 'Service_Parking' THEN 'Паркинг'
    ELSE 'Успешный'
  END
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

  IF category IS DISTINCT FROM 'Исходящие'
     OR (status IS DISTINCT FROM 'Успешный' AND status IS DISTINCT FROM 'Паркинг') THEN
    RETURN;
  END IF;

  b := btrim(bill_dnis);
  IF b !~ '^7[0-9]{10}$' THEN
    RETURN;
  END IF;

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

  IF call_type = 'Местный' THEN
    direction := v_dir;
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

  direction := v_dir;
  charge := cdr_kopecks_text(charge_k);
  price := cdr_tariff_price_text(v_price);
  RETURN;
END;
$fn$;

