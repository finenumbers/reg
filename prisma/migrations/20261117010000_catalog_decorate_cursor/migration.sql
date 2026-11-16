-- Durable resplit, mask, and client debt, plus the last committed batch.
-- Does not rewrite catalog rows. Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "numbering_catalog_state"
    ADD COLUMN "resplit_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "resplit_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mask_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mask_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "client_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "client_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "client_hash" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "cursor_phase" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "cursor_after" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "cursor_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "cursor_provider" TEXT NOT NULL DEFAULT '';
