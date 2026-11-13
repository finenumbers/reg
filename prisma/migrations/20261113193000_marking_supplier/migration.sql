-- Adds marking_rows.supplier and includes it in the on-switch index.
-- Backfill copies the same RTU card the marking list uses for the client.
-- A number outside that set keeps an empty supplier.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.

ALTER TABLE "marking_rows" ADD COLUMN "supplier" TEXT NOT NULL DEFAULT '';

UPDATE "marking_rows" AS m
SET "supplier" = picked.supplier
FROM (
  SELECT number, supplier
  FROM (
    SELECT DISTINCT ON (btrim(s.number))
      btrim(s.number) AS number,
      btrim(s.supplier) AS supplier,
      c.phone AS pstn_phone,
      c.found AS pstn_found,
      c.operator AS pstn_operator
    FROM "rtu_screen" s
    LEFT JOIN "pstn_phone_cache" c ON c.phone = s."pstnKey"
    WHERE NOT s.missing
      AND btrim(s.number) <> ''
      AND s.activation <> 'Нет в РТУ'
    ORDER BY btrim(s.number), (btrim(s.client) = ''), s.id
  ) card
  WHERE (
    CASE
      WHEN pstn_phone IS NULL THEN ''
      WHEN pstn_found IS NOT TRUE
        OR pstn_operator IS NULL
        OR btrim(pstn_operator) = '' THEN 'Нет в реестре МинЦифры'
      ELSE btrim(pstn_operator)
    END
  ) <> 'Нет в реестре МинЦифры'
) AS picked
WHERE m."phoneNumber" = picked.number;

DROP INDEX "rtu_screen_on_switch_idx";

CREATE INDEX "rtu_screen_on_switch_idx"
  ON "rtu_screen" ("number", "id")
  INCLUDE ("client", "supplier", "pstnKey")
  WHERE NOT missing;
