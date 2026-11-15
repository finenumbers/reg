-- Runexis partner list and free-number prices. Catalog rows are not rewritten.
-- Label-free: startup must not scan cdr_records.

ALTER TABLE "runexis_sync_state" ADD COLUMN "list" TEXT NOT NULL DEFAULT '';
ALTER TABLE "runexis_sync_state" ADD COLUMN "last_purchased_written" INTEGER;

ALTER TABLE "runexis_sync_state"
  ADD CONSTRAINT "runexis_sync_state_list_check"
  CHECK ("list" IN ('', 'showcase', 'management'));

ALTER TABLE "runexis_sync_stage" DROP CONSTRAINT "runexis_sync_stage_pkey";

ALTER TABLE "runexis_sync_stage" ADD COLUMN "catalog" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "runexis_sync_stage" ADD COLUMN "incoming_purchase" TEXT NOT NULL DEFAULT '';
ALTER TABLE "runexis_sync_stage" ADD COLUMN "incoming_period" TEXT NOT NULL DEFAULT '';
ALTER TABLE "runexis_sync_stage" ALTER COLUMN "catalog" DROP DEFAULT;

ALTER TABLE "runexis_sync_stage"
  ADD CONSTRAINT "runexis_sync_stage_catalog_check"
  CHECK ("catalog" IN ('free', 'purchased'));

ALTER TABLE "runexis_sync_stage"
  ADD CONSTRAINT "runexis_sync_stage_pkey" PRIMARY KEY ("run_id", "catalog", "e164");
