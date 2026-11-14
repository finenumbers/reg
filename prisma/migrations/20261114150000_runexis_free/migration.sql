-- Runexis free-number lease and draft. Catalog rows are not rewritten.
-- Label-free: startup must not scan cdr_records.

ALTER TABLE "app_settings" ADD COLUMN "runexisEmail" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "runexisPasswordCiphertext" TEXT;

CREATE TABLE "runexis_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "run_id" TEXT,
    "phase" TEXT NOT NULL DEFAULT '',
    "page_done" INTEGER NOT NULL DEFAULT 0,
    "page_total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_free_written" INTEGER,
    "last_finished_at" TIMESTAMP(3),

    CONSTRAINT "runexis_sync_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "runexis_sync_state_singleton" CHECK ("id" = 1)
);

INSERT INTO "runexis_sync_state" ("id") VALUES (1);

CREATE TABLE "runexis_sync_stage" (
    "run_id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "ready" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "runexis_sync_stage_pkey" PRIMARY KEY ("run_id", "e164")
);
