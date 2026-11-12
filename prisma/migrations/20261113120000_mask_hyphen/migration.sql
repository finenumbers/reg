-- A hyphen in a mask is not a digit and not a letter.
-- The stored mask stays as loaded. The fit compares letters and digits only.
-- Does not rewrite phone, tariff, CDR, PSTN, or screen rows.
-- Does not scan cdr_records.

CREATE OR REPLACE FUNCTION rtu_mask_fits(mask text, telephone text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  significant text;
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
  IF mask !~ '^[0-9A-DX-Z-]+$' OR telephone !~ '^[0-9]+$' THEN
    RETURN FALSE;
  END IF;
  significant := regexp_replace(mask, '-', '', 'g');
  IF significant !~ '^[0-9A-DX-Z]+$' OR length(significant) <> length(telephone) THEN
    RETURN FALSE;
  END IF;
  FOR i IN 1..length(significant) LOOP
    symbol := substring(significant FROM i FOR 1);
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
