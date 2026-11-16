-- Voximplant key, lease, and draft. Catalog rows are not rewritten.
-- Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "numbering_catalog_state"
    ADD COLUMN "voximplant_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "voximplant_done" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "app_settings" ADD COLUMN "voximplantCredentialsCiphertext" TEXT;

CREATE TABLE "voximplant_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "run_id" TEXT,
    "phase" TEXT NOT NULL DEFAULT '',
    "list" TEXT NOT NULL DEFAULT '',
    "page_done" INTEGER NOT NULL DEFAULT 0,
    "page_total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_free_written" INTEGER,
    "last_purchased_written" INTEGER,
    "last_finished_at" TIMESTAMP(3),

    CONSTRAINT "voximplant_sync_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voximplant_sync_state_singleton" CHECK ("id" = 1),
    CONSTRAINT "voximplant_sync_state_list_check" CHECK ("list" IN ('', 'purchased', 'free'))
);

INSERT INTO "voximplant_sync_state" ("id") VALUES (1);

CREATE TABLE "voximplant_sync_stage" (
    "run_id" TEXT NOT NULL,
    "catalog" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "incoming_purchase" TEXT NOT NULL DEFAULT '',
    "incoming_period" TEXT NOT NULL DEFAULT '',
    "ready" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "voximplant_sync_stage_catalog_check" CHECK ("catalog" IN ('free', 'purchased')),
    CONSTRAINT "voximplant_sync_stage_pkey" PRIMARY KEY ("run_id", "catalog", "e164")
);
