-- Card columns for the sync page.
-- Does not rewrite catalog rows. Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "numbering_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "runexis_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "uis_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "aurora_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "exolve_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "voximplant_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

ALTER TABLE "mcn_sync_state"
    ADD COLUMN "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loaded_at" TIMESTAMP(3);

UPDATE "numbering_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "runexis_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "uis_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "aurora_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "exolve_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "voximplant_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

UPDATE "mcn_sync_state"
SET "loaded_at" = "last_finished_at"
WHERE "id" = 1 AND "last_error" IS NULL AND "last_finished_at" IS NOT NULL;

ALTER TABLE "numbering_catalog_state"
    ADD COLUMN "sipout_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "runexis_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "uis_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "aurora_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "exolve_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "voximplant_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mcn_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "parsed_pass" TEXT NOT NULL DEFAULT '';
