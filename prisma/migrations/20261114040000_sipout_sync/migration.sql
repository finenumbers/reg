-- SipOut key, national digits, and a staging lease for one numbering walk.
-- Does not rewrite phone, tariff, CDR, PSTN, or RTU screen rows.
-- Existing free and purchased rows gain an empty e164. Their other cells stay.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.
-- pg_trgm already exists. The trigram indexes are not in the Prisma schema.

ALTER TABLE "app_settings" ADD COLUMN "sipoutApiKeyCiphertext" TEXT;

ALTER TABLE "free_numbers" ADD COLUMN "e164" TEXT NOT NULL DEFAULT '';
ALTER TABLE "purchased_numbers" ADD COLUMN "e164" TEXT NOT NULL DEFAULT '';

CREATE INDEX "free_numbers_provider_idx" ON "free_numbers" ("provider");
CREATE INDEX "purchased_numbers_provider_idx" ON "purchased_numbers" ("provider");

CREATE INDEX "free_numbers_e164_trgm_idx" ON "free_numbers" USING gin ("e164" gin_trgm_ops);
CREATE INDEX "purchased_numbers_e164_trgm_idx" ON "purchased_numbers" USING gin ("e164" gin_trgm_ops);

CREATE UNIQUE INDEX "free_numbers_provider_e164_uidx"
  ON "free_numbers" ("provider", "e164")
  WHERE "e164" <> '';

CREATE UNIQUE INDEX "purchased_numbers_provider_e164_uidx"
  ON "purchased_numbers" ("provider", "e164")
  WHERE "e164" <> '';

CREATE TABLE "numbering_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "run_id" TEXT,
    "catalog" TEXT,
    "phase" TEXT NOT NULL DEFAULT '',
    "cities_done" INTEGER NOT NULL DEFAULT 0,
    "cities_total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "last_catalog" TEXT,
    "last_error" TEXT,
    "last_written" INTEGER,
    "last_finished_at" TIMESTAMP(3),

    CONSTRAINT "numbering_sync_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "numbering_sync_state_singleton" CHECK ("id" = 1)
);

INSERT INTO "numbering_sync_state" ("id") VALUES (1);

CREATE TABLE "numbering_sync_stage" (
    "run_id" TEXT NOT NULL,
    "catalog" TEXT NOT NULL,
    "e164" TEXT NOT NULL,

    CONSTRAINT "numbering_sync_stage_pkey" PRIMARY KEY ("run_id", "catalog", "e164")
);
