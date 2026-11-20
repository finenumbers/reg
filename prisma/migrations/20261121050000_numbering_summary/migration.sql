-- Numbering summary counts and the PSTN hit class.
-- Nullable pstn_hits. Existing catalog rows stay. Does not scan the call journal.
-- Label-free. lock_timeout is 15 seconds.

SET lock_timeout = '15s';

ALTER TABLE "free_numbers"
  ADD COLUMN "pstn_hits" SMALLINT;

ALTER TABLE "purchased_numbers"
  ADD COLUMN "pstn_hits" SMALLINT;

ALTER TABLE "free_numbers"
  ADD CONSTRAINT "free_numbers_pstn_hits_check"
  CHECK ("pstn_hits" IS NULL OR "pstn_hits" IN (0, 1, 2));

ALTER TABLE "purchased_numbers"
  ADD CONSTRAINT "purchased_numbers_pstn_hits_check"
  CHECK ("pstn_hits" IS NULL OR "pstn_hits" IN (0, 1, 2));

CREATE TABLE "numbering_load_snapshot" (
  "provider" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "as_of" DATE NOT NULL,
  "loaded_at" TIMESTAMPTZ,
  CONSTRAINT "numbering_load_snapshot_pkey" PRIMARY KEY ("provider", "side"),
  CONSTRAINT "numbering_load_snapshot_side_check"
    CHECK ("side" IN ('free', 'purchased'))
);
