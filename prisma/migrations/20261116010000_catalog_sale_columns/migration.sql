-- Rename free-number money columns and store mask cells on the drafts.
-- Copies free_numbers by name. A drifted copy raises and the transaction rolls back.
-- Does not scan cdr_records. Does not call a numbering source.
-- Does not fill mask or client cells. The app does that after it starts.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

CREATE TABLE "free_numbers_next" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "purchase" TEXT NOT NULL DEFAULT '',
    "subscription" TEXT NOT NULL DEFAULT '',
    "mask" TEXT NOT NULL DEFAULT '',
    "maskType" TEXT NOT NULL DEFAULT '',
    "sale" TEXT NOT NULL DEFAULT '',
    "premium" TEXT NOT NULL DEFAULT '',
    "operator" TEXT NOT NULL DEFAULT '',
    "geography" TEXT NOT NULL DEFAULT '',
    "e164" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "free_numbers_next_pkey" PRIMARY KEY ("id")
);

INSERT INTO "free_numbers_next" (
    "id",
    "provider",
    "abc",
    "number",
    "category",
    "city",
    "region",
    "purchase",
    "subscription",
    "mask",
    "maskType",
    "sale",
    "premium",
    "operator",
    "geography",
    "e164"
)
SELECT
    "id",
    "provider",
    "abc",
    "number",
    "category",
    "city",
    "region",
    "incomingPurchase",
    "incomingPeriod",
    "mask",
    "maskType",
    "purchase",
    "premium",
    "operator",
    "geography",
    "e164"
FROM "free_numbers";

DO $$
DECLARE
    old_n bigint;
    new_n bigint;
    drifted bigint;
BEGIN
    SELECT count(*) INTO old_n FROM "free_numbers";
    SELECT count(*) INTO new_n FROM "free_numbers_next";
    IF old_n <> new_n THEN
        RAISE EXCEPTION 'free_numbers row count changed';
    END IF;

    SELECT count(*) INTO drifted
    FROM "free_numbers" AS o
    JOIN "free_numbers_next" AS n ON n."id" = o."id"
    WHERE o."provider" IS DISTINCT FROM n."provider"
       OR o."abc" IS DISTINCT FROM n."abc"
       OR o."number" IS DISTINCT FROM n."number"
       OR o."category" IS DISTINCT FROM n."category"
       OR o."city" IS DISTINCT FROM n."city"
       OR o."region" IS DISTINCT FROM n."region"
       OR o."incomingPurchase" IS DISTINCT FROM n."purchase"
       OR o."incomingPeriod" IS DISTINCT FROM n."subscription"
       OR o."mask" IS DISTINCT FROM n."mask"
       OR o."maskType" IS DISTINCT FROM n."maskType"
       OR o."purchase" IS DISTINCT FROM n."sale"
       OR o."premium" IS DISTINCT FROM n."premium"
       OR o."operator" IS DISTINCT FROM n."operator"
       OR o."geography" IS DISTINCT FROM n."geography"
       OR o."e164" IS DISTINCT FROM n."e164";

    IF drifted <> 0 THEN
        RAISE EXCEPTION 'free_numbers column copy drifted';
    END IF;
END $$;

DROP TABLE "free_numbers";

ALTER TABLE "free_numbers_next" RENAME TO "free_numbers";

ALTER TABLE "free_numbers" RENAME CONSTRAINT "free_numbers_next_pkey" TO "free_numbers_pkey";

CREATE INDEX "free_numbers_order_idx" ON "free_numbers" ("abc", "number", "id");

CREATE INDEX "free_numbers_provider_idx" ON "free_numbers" ("provider");

CREATE INDEX "free_numbers_number_trgm_idx" ON "free_numbers" USING gin ("number" gin_trgm_ops);

CREATE INDEX "free_numbers_e164_trgm_idx" ON "free_numbers" USING gin ("e164" gin_trgm_ops);

CREATE UNIQUE INDEX "free_numbers_provider_e164_uidx"
    ON "free_numbers" ("provider", "e164")
    WHERE "e164" <> '';

ALTER TABLE "rtu_screen" RENAME COLUMN "purchase" TO "sale";

ALTER TABLE "numbering_sync_stage"
    ADD COLUMN "incoming_period" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_type" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_price" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "premium" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "client" TEXT NOT NULL DEFAULT '';

ALTER TABLE "runexis_sync_stage"
    ADD COLUMN "mask" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_type" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_price" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "premium" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "client" TEXT NOT NULL DEFAULT '';

ALTER TABLE "uis_sync_stage"
    ADD COLUMN "mask" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_type" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mask_price" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "premium" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "client" TEXT NOT NULL DEFAULT '';

CREATE TABLE "numbering_catalog_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "decorate_generation" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "numbering_catalog_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "numbering_catalog_state_singleton" CHECK ("id" = 1)
);

INSERT INTO "numbering_catalog_state" ("id", "decorate_generation") VALUES (1, 0);
