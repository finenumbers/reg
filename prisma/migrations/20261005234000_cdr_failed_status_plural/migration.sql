-- Plural failed status «Неуспешные».
-- Existing rows are rewritten by scripts/cdr-call-class-backfill.mjs
-- after this migration. `npx prisma migrate deploy` alone does not.
-- Do not DROP this function: cdr_apply_call_class calls it.

CREATE OR REPLACE FUNCTION cdr_call_status(elapsed_time text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
SELECT CASE WHEN elapsed_time = '' THEN 'Неуспешные' ELSE 'Успешный' END
$fn$;
