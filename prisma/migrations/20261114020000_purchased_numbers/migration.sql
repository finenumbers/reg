-- Empty catalog for «Купленные номера».
-- Nullable numbering-source origins and token ciphertext on app_settings.
-- Does not rewrite phone, tariff, CDR, PSTN, RTU screen, or free_numbers rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.
-- pg_trgm already exists. The trigram index is not in the Prisma schema.

CREATE TABLE "purchased_numbers" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "mask" TEXT NOT NULL DEFAULT '',
    "maskType" TEXT NOT NULL DEFAULT '',
    "purchase" TEXT NOT NULL DEFAULT '',
    "premium" TEXT NOT NULL DEFAULT '',
    "operator" TEXT NOT NULL DEFAULT '',
    "geography" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "purchased_numbers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchased_numbers_order_idx" ON "purchased_numbers" ("abc", "number", "id");

CREATE INDEX "purchased_numbers_number_trgm_idx" ON "purchased_numbers" USING gin ("number" gin_trgm_ops);

ALTER TABLE "app_settings" ADD COLUMN "freeNumbersSourceBaseUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "freeNumbersSourceTokenCiphertext" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "purchasedNumbersSourceBaseUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "purchasedNumbersSourceTokenCiphertext" TEXT;
