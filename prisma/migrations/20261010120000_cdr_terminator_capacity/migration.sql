-- Terminator capacity is the same error type as originator capacity.
-- The v1.94.0 functions stay as shipped. Do not drop these functions: the insert trigger calls them.
-- Existing rows are rewritten by scripts/cdr-tariff-backfill.mjs after this migration.

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
