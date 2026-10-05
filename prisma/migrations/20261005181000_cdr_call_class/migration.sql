-- Derived call category and status.
-- Existing rows stay '' until scripts/cdr-call-class-backfill.mjs.
-- `npx prisma migrate deploy` alone does not fill them. The compose migrator
-- and scripts/db-migrate.sh run that script after this migration.

ALTER TABLE "cdr_records" ADD COLUMN "call_category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "call_status" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION cdr_call_category(side_a text, side_b text, dst_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
SELECT CASE
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', 'Нет в биллинге') AND side_b IN ('', 'Нет в биллинге') THEN 'Фантомный звонок'
    WHEN dst_name = 'Service_Parking' AND side_a IN ('', 'Нет в биллинге') AND side_b NOT IN ('', 'Нет в биллинге') THEN 'Входящий паркинг'
    WHEN dst_name = 'Service_Parking' AND side_a NOT IN ('', 'Нет в биллинге') THEN 'Исходящий паркинг'
    WHEN side_a NOT IN ('', 'Нет в биллинге') AND side_b IN ('', 'Нет в биллинге') THEN 'Исходящий звонок'
    WHEN side_a IN ('', 'Нет в биллинге') AND side_b NOT IN ('', 'Нет в биллинге') THEN 'Входящий звонок'
    WHEN side_a NOT IN ('', 'Нет в биллинге') AND side_b NOT IN ('', 'Нет в биллинге') THEN 'Внутренний звонок'
    ELSE 'Ошибка'
  END
$fn$;

CREATE OR REPLACE FUNCTION cdr_call_status(elapsed_time text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
SELECT CASE WHEN elapsed_time = '' THEN 'Неудачный' ELSE 'Удачный' END
$fn$;

CREATE OR REPLACE FUNCTION cdr_apply_call_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.call_category := cdr_call_category(NEW.side_a, NEW.side_b, NEW.dst_name);
  NEW.call_status := cdr_call_status(NEW.elapsed_time);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS cdr_apply_call_class ON cdr_records;

CREATE TRIGGER cdr_apply_call_class
BEFORE INSERT OR UPDATE ON cdr_records
FOR EACH ROW
EXECUTE FUNCTION cdr_apply_call_class();
