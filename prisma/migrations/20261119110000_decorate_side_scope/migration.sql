-- Which catalog side a provider epoch still has to decorate.
-- Empty means both sides, so a pass already open keeps walking both.
-- Does not read cdr_records. Does not rewrite catalog rows.
-- Label-free. lock_timeout is 15 seconds.

SET lock_timeout = '15s';

ALTER TABLE "numbering_catalog_state"
  ADD COLUMN "sipout_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "runexis_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "uis_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "aurora_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "exolve_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "voximplant_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mcn_scope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "finenumbers_scope" TEXT NOT NULL DEFAULT '';

ALTER TABLE "numbering_catalog_state"
  ADD CONSTRAINT "numbering_catalog_state_sipout_scope_check"
    CHECK ("sipout_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_runexis_scope_check"
    CHECK ("runexis_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_uis_scope_check"
    CHECK ("uis_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_aurora_scope_check"
    CHECK ("aurora_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_exolve_scope_check"
    CHECK ("exolve_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_voximplant_scope_check"
    CHECK ("voximplant_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_mcn_scope_check"
    CHECK ("mcn_scope" IN ('', 'free', 'purchased', 'both')),
  ADD CONSTRAINT "numbering_catalog_state_finenumbers_scope_check"
    CHECK ("finenumbers_scope" IN ('', 'free', 'purchased', 'both'));
