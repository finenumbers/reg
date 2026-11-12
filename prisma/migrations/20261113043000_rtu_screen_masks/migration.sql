-- Screen columns for the mask catalog.
-- Adds empty text on rtu_screen and one integer generation.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not scan cdr_records.
-- A loaded mask catalog becomes generation 1 so the first start rebuilds the screen once.

ALTER TABLE "rtu_screen"
  ADD COLUMN "mask" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "maskType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "purchase" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "premium" TEXT NOT NULL DEFAULT '';

ALTER TABLE "rtu_screen_state"
  ADD COLUMN "maskGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "number_mask_import_state"
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

UPDATE "number_mask_import_state"
SET "generation" = 1
WHERE "id" = 1
  AND "rowCount" > 0;

CREATE INDEX "number_masks_category_length_idx"
  ON "number_masks" ("category", "digitLength");

CREATE FUNCTION rtu_mask_literals(mask text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(length(regexp_replace(COALESCE(mask, ''), '[^0-9]', '', 'g')), 0);
$fn$;

CREATE FUNCTION rtu_mask_repeats(mask text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  i integer;
  symbol text;
  total integer := 0;
BEGIN
  IF mask IS NULL OR mask = '' THEN
    RETURN 0;
  END IF;
  FOR i IN 1..length(mask) LOOP
    symbol := substring(mask FROM i FOR 1);
    IF symbol ~ '^[A-DX-Z]$'
      AND length(mask) - length(replace(mask, symbol, '')) > 1 THEN
      total := total + 1;
    END IF;
  END LOOP;
  RETURN total;
END;
$fn$;

-- One letter is one digit. A second letter is a different digit.
-- A letter may equal a digit that is written in the same mask.
CREATE FUNCTION rtu_mask_fits(mask text, telephone text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  i integer;
  symbol text;
  digit text;
  seen text[] := ARRAY[]::text[];
  used text[] := ARRAY[]::text[];
  pos integer;
BEGIN
  IF mask IS NULL OR telephone IS NULL THEN
    RETURN FALSE;
  END IF;
  IF length(mask) <> length(telephone) THEN
    RETURN FALSE;
  END IF;
  IF telephone !~ '^[0-9]+$' OR mask !~ '^[0-9A-DX-Z]+$' THEN
    RETURN FALSE;
  END IF;
  FOR i IN 1..length(mask) LOOP
    symbol := substring(mask FROM i FOR 1);
    digit := substring(telephone FROM i FOR 1);
    IF symbol ~ '^[0-9]$' THEN
      IF symbol <> digit THEN
        RETURN FALSE;
      END IF;
    ELSE
      pos := array_position(seen, symbol);
      IF pos IS NULL THEN
        IF digit = ANY(used) THEN
          RETURN FALSE;
        END IF;
        seen := array_append(seen, symbol);
        used := array_append(used, digit);
      ELSIF used[pos] IS DISTINCT FROM digit THEN
        RETURN FALSE;
      END IF;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$fn$;

-- One catalog row for a screen number. No row means the four cells stay empty.
-- «Мобильные РФ» and «Бесплатный вызов» are read before the yellow-row flag.
CREATE FUNCTION rtu_mask_lookup(city text, city_alert boolean, abc text, telephone text)
RETURNS TABLE(mask text, mask_type text, purchase text, premium text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  trimmed_city text := btrim(COALESCE(city, ''));
  trimmed_abc text := btrim(COALESCE(abc, ''));
  trimmed_phone text := btrim(COALESCE(telephone, ''));
  mapped text;
  stripped text;
BEGIN
  IF trimmed_city = 'Мобильные РФ' THEN
    mapped := 'Мобильный';
  ELSIF trimmed_city = 'Бесплатный вызов' THEN
    mapped := 'Бесплатный вызов';
  ELSIF city_alert IS TRUE OR trimmed_city = '' THEN
    RETURN;
  ELSE
    mapped := 'Городской';
  END IF;

  IF trimmed_phone !~ '^[0-9]{5,7}$' THEN
    RETURN;
  END IF;

  IF left(trimmed_abc, 1) = '7' AND length(trimmed_abc) > 1 THEN
    stripped := substring(trimmed_abc FROM 2);
  ELSE
    stripped := NULL;
  END IF;

  RETURN QUERY
  SELECT
    picked.mask,
    picked.mask_type,
    picked.purchase,
    picked.premium
  FROM (
    SELECT
      m.mask AS mask,
      COALESCE(m."maskType", '') AS mask_type,
      COALESCE(m.purchase, '') AS purchase,
      COALESCE(m.premium, '') AS premium,
      rtu_mask_literals(m.mask) AS literals,
      rtu_mask_repeats(m.mask) AS repeats,
      CASE
        WHEN m.abc IS NOT NULL AND btrim(m.abc) <> '' AND m.abc = trimmed_abc THEN 0
        WHEN stripped IS NOT NULL AND m.abc = stripped THEN 1
        ELSE 2
      END AS abc_rank,
      m."sortIndex" AS sort_index
    FROM number_masks m
    WHERE m.category = mapped
      AND m."digitLength" = length(trimmed_phone)
      AND (
        m.abc IS NULL
        OR btrim(m.abc) = ''
        OR m.abc = trimmed_abc
        OR (stripped IS NOT NULL AND m.abc = stripped)
      )
      AND rtu_mask_fits(m.mask, trimmed_phone)
  ) AS picked
  ORDER BY picked.literals DESC, picked.repeats DESC, picked.abc_rank ASC, picked.sort_index ASC
  LIMIT 1;
END;
$fn$;
