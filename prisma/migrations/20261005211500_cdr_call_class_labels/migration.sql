-- Rename «Фантомный звонок» and statuses «Удачный» / «Неудачный».
-- Existing rows are rewritten by scripts/cdr-call-class-backfill.mjs
-- after this migration. `npx prisma migrate deploy` alone does not.

CREATE OR REPLACE FUNCTION cdr_call_category(
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
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b IN ('', '-') THEN 'Фантомный трафик'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий паркинг'
    WHEN dst_name = 'Service_Parking' AND side_a NOT IN ('', '-') THEN 'Исходящий паркинг'
    WHEN side_a NOT IN ('', '-') AND side_b IN ('', '-') THEN 'Исходящий звонок'
    WHEN side_a IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Входящий звонок'
    WHEN side_a NOT IN ('', '-') AND side_b NOT IN ('', '-') THEN 'Внутренний звонок'
    ELSE 'Ошибка'
  END
$fn$;

CREATE OR REPLACE FUNCTION cdr_call_status(elapsed_time text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
SELECT CASE WHEN elapsed_time = '' THEN 'Неуспешный' ELSE 'Успешный' END
$fn$;
