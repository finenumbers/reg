-- A replaced provider catalog still needs mask and client cells.
-- Does not rewrite catalog rows. Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "numbering_catalog_state"
    ADD COLUMN "sipout_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "sipout_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "runexis_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "runexis_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "uis_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "uis_done" INTEGER NOT NULL DEFAULT 0;
