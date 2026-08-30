-- Stored day/time parts of civil cdr_date for table facets (not generated).
ALTER TABLE "cdr_records" ADD COLUMN "cdr_day" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "cdr_time" TEXT NOT NULL DEFAULT '';

UPDATE "cdr_records"
SET
  cdr_day = left(cdr_date, 10),
  cdr_time = substring(cdr_date from 12 for 8)
WHERE cdr_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}';
