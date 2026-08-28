-- Month export range + keyset on the civil cdr_date string.
CREATE INDEX "cdr_records_cdr_date_cdr_id_idx" ON "cdr_records"("cdr_date", "cdr_id");

-- Pack stored call time from cdr_date digits as UTC (no display timezone).
UPDATE "cdr_records"
SET "cdrAt" = make_timestamptz(
  substring(cdr_date from 1 for 4)::int,
  substring(cdr_date from 6 for 2)::int,
  substring(cdr_date from 9 for 2)::int,
  substring(cdr_date from 12 for 2)::int,
  substring(cdr_date from 15 for 2)::int,
  substring(cdr_date from 18 for 2)::double precision,
  'UTC'
)
WHERE cdr_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}';
