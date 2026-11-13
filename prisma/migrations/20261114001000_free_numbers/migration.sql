-- Empty catalog for «Свободные номера».
-- Does not rewrite phone, tariff, CDR, PSTN, or RTU screen rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.
-- pg_trgm already exists. The trigram index is not in the Prisma schema.

CREATE TABLE "free_numbers" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "mask" TEXT NOT NULL DEFAULT '',
    "maskType" TEXT NOT NULL DEFAULT '',
    "incomingPurchase" TEXT NOT NULL DEFAULT '',
    "incomingPeriod" TEXT NOT NULL DEFAULT '',
    "purchase" TEXT NOT NULL DEFAULT '',
    "premium" TEXT NOT NULL DEFAULT '',
    "operator" TEXT NOT NULL DEFAULT '',
    "geography" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "free_numbers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "free_numbers_order_idx" ON "free_numbers" ("abc", "number", "id");

CREATE INDEX "free_numbers_number_trgm_idx" ON "free_numbers" USING gin ("number" gin_trgm_ops);
