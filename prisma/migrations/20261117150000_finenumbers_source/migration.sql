-- Finenumbers is the eighth numbering source. It has no secret.
-- The PSTN range snapshot fills operator and geography later.
-- DID settings and the DID snapshot are removed.
-- Does not rewrite free_numbers, purchased_numbers, or cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "numbering_catalog_state"
    ADD COLUMN "finenumbers_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "finenumbers_done" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "finenumbers_parsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "pstn_range_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "pstn_range_done" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "finenumbers_sync_state" (
    "id" INTEGER NOT NULL,
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
    "duplicates_dropped" INTEGER NOT NULL DEFAULT 0,
    "loaded_at" TIMESTAMP(3),
    CONSTRAINT "finenumbers_sync_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "finenumbers_sync_state_id_check" CHECK ("id" = 1),
    CONSTRAINT "finenumbers_sync_state_list_check" CHECK ("list" IN ('', 'purchased', 'free'))
);

INSERT INTO "finenumbers_sync_state" ("id") VALUES (1);

CREATE TABLE "finenumbers_sync_stage" (
    "run_id" TEXT NOT NULL,
    "catalog" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "incoming_purchase" TEXT NOT NULL DEFAULT '',
    "incoming_period" TEXT NOT NULL DEFAULT '',
    "operator" TEXT NOT NULL DEFAULT '',
    "geography" TEXT NOT NULL DEFAULT '',
    "ready" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "finenumbers_sync_stage_pkey" PRIMARY KEY ("run_id", "catalog", "e164"),
    CONSTRAINT "finenumbers_sync_stage_catalog_check" CHECK ("catalog" IN ('free', 'purchased'))
);

CREATE TABLE "pstn_range_state" (
    "id" INTEGER NOT NULL,
    "loaded_at" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "pstn_range_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pstn_range_state_id_check" CHECK ("id" = 1)
);

INSERT INTO "pstn_range_state" ("id") VALUES (1);

CREATE TABLE "pstn_range_snapshot" (
    "abc" TEXT NOT NULL,
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "operator" TEXT NOT NULL DEFAULT '',
    "gar_territory" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "pstn_range_snapshot_pkey" PRIMARY KEY ("abc", "range_start", "range_end")
);

CREATE TABLE "pstn_range_load" (
    "abc" TEXT NOT NULL,
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "operator" TEXT NOT NULL DEFAULT '',
    "gar_territory" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "pstn_range_load_pkey" PRIMARY KEY ("abc", "range_start", "range_end")
);

DROP TABLE "geography_did_sources";
DROP TABLE "geography_did_state";

ALTER TABLE "app_settings" DROP COLUMN "didBaseUrl";
ALTER TABLE "app_settings" DROP COLUMN "didApiTokenCiphertext";
