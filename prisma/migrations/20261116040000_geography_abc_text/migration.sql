-- Screen text for the ABC column menu. The same calls are indexed below.
-- Does not rewrite rows. Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

CREATE FUNCTION geography_abc_text(full_number text, abc text, telephone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN COALESCE(abc, '') <> ''
      AND btrim(COALESCE(full_number, '')) = COALESCE(abc, '') || COALESCE(telephone, '')
      AND left(COALESCE(abc, ''), 1) = '7'
      THEN CASE
        WHEN length(COALESCE(abc, '')) = 1 THEN '7'
        ELSE '7 (' || substring(COALESCE(abc, '') FROM 2) || ')'
      END
    WHEN COALESCE(abc, '') <> ''
      AND left(COALESCE(abc, ''), 1) <> '7'
      AND btrim(COALESCE(full_number, '')) = '7' || COALESCE(abc, '') || COALESCE(telephone, '')
      THEN '7 (' || COALESCE(abc, '') || ')'
    ELSE COALESCE(abc, '')
  END;
$fn$;

CREATE INDEX "free_numbers_abc_text_order_idx"
    ON "free_numbers" (geography_abc_text(e164, abc, "number"), abc, "number", id);

CREATE INDEX "purchased_numbers_abc_text_order_idx"
    ON "purchased_numbers" (geography_abc_text(e164, abc, "number"), abc, "number", id);

CREATE INDEX "rtu_screen_abc_text_order_idx"
    ON "rtu_screen" (geography_abc_text(number, abc, telephone), number, id);
