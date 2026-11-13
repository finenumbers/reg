-- One SipOut stage stores both catalog counts and the tariff cells of the draft.
-- Drops the unused free/purchased origin columns. They were never read by a loader.
-- Does not rewrite phone, tariff, CDR, PSTN, RTU screen, or catalog rows.
-- Label-free: startup must not scan cdr_records.

ALTER TABLE "app_settings" DROP COLUMN "freeNumbersSourceBaseUrl";
ALTER TABLE "app_settings" DROP COLUMN "freeNumbersSourceTokenCiphertext";
ALTER TABLE "app_settings" DROP COLUMN "purchasedNumbersSourceBaseUrl";
ALTER TABLE "app_settings" DROP COLUMN "purchasedNumbersSourceTokenCiphertext";

ALTER TABLE "numbering_sync_state" ADD COLUMN "last_free_written" INTEGER;
ALTER TABLE "numbering_sync_state" ADD COLUMN "last_purchased_written" INTEGER;
ALTER TABLE "numbering_sync_state" DROP COLUMN "last_written";

ALTER TABLE "numbering_sync_stage" ADD COLUMN "abc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "numbering_sync_stage" ADD COLUMN "number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "numbering_sync_stage" ADD COLUMN "city" TEXT NOT NULL DEFAULT '';
ALTER TABLE "numbering_sync_stage" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';
ALTER TABLE "numbering_sync_stage" ADD COLUMN "ready" BOOLEAN NOT NULL DEFAULT false;
