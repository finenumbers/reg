-- One stamp per catalog side. The dropped-copy counter is gone.
-- Does not read cdr_records. Does not rewrite free_numbers or purchased_numbers.
-- Label-free. lock_timeout is 15 seconds.

SET lock_timeout = '15s';

ALTER TABLE "numbering_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "runexis_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "uis_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "aurora_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "exolve_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "voximplant_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "mcn_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);
ALTER TABLE "finenumbers_sync_state"
  ADD COLUMN "purchased_loaded_at" TIMESTAMP(3),
  ADD COLUMN "free_loaded_at" TIMESTAMP(3);

UPDATE "numbering_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "runexis_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "uis_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "aurora_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "exolve_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "voximplant_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "mcn_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";
UPDATE "finenumbers_sync_state" SET "purchased_loaded_at" = "loaded_at", "free_loaded_at" = "loaded_at";

ALTER TABLE "numbering_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "runexis_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "uis_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "aurora_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "exolve_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "voximplant_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "mcn_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
ALTER TABLE "finenumbers_sync_state" DROP COLUMN "duplicates_dropped", DROP COLUMN "loaded_at";
