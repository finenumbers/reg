-- Extra call categories and the billing-miss sentinel «-».
-- Existing rows are rewritten by scripts/cdr-call-class-backfill.mjs
-- after this migration. `npx prisma migrate deploy` alone does not.

CREATE FUNCTION cdr_call_category(
  side_a text,
  side_b text,
  dst_name text,
  src_name text,
  disconnect_code_string text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
SELECT CASE
    WHEN starts_with(src_name, 'Redirect_') THEN 'Редирект'
    WHEN dst_name = 'Service_Check' THEN 'Проверка'
    WHEN disconnect_code_string = 'Class4, 1 - Unregistered IP Address' THEN 'Нет регистрации'
    WHEN disconnect_code_string = 'Class4, 40 - Gateway Is Invalid' THEN 'Ошибка маршрута'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN 'Фантомный звонок'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий паркинг'
    WHEN dst_name = 'Service_Parking' AND side_a NOT IN ('', '-') THEN 'Исходящий паркинг'
    WHEN side_a NOT IN ('', '-') AND side_b IN ('', '-') THEN 'Исходящий звонок'
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий звонок'
    WHEN side_a NOT IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Внутренний звонок'
    ELSE 'Ошибка'
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
    NEW.disconnect_code_string
  );
  NEW.call_status := cdr_call_status(NEW.elapsed_time);
  RETURN NEW;
END;
$fn$;

DROP FUNCTION cdr_call_category(text, text, text);
