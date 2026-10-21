-- Clock for «с последней загрузки». New columns only. Existing calls stay.

ALTER TABLE "radius_ingest_states"
ADD COLUMN "last_data_at" TIMESTAMP(3),
ADD COLUMN "last_data_had_rows" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "last_checked_at" TIMESTAMP(3);

UPDATE "radius_ingest_states" AS s
SET
  "last_data_at" = calls.latest,
  "last_data_had_rows" = calls.latest IS NOT NULL,
  "last_checked_at" = CASE
    WHEN s."last_success_at" IS NOT NULL
      AND (
        calls.latest IS NULL
        OR s."last_success_at" > calls.latest + INTERVAL '2 seconds'
      )
    THEN s."last_success_at"
    ELSE NULL
  END
FROM (SELECT MAX("created_at") AS latest FROM "radius_calls") AS calls
WHERE s."id" = 1;
