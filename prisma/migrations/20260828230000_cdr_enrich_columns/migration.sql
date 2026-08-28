-- AlterTable
ALTER TABLE "cdr_records" ADD COLUMN "side_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "operator_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "geography_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "side_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "operator_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "geography_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "country_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "city_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "provider_a" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "country_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "city_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "provider_b" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdr_records" ADD COLUMN "enriched_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "cdr_records_unenriched_cdr_at_idx" ON "cdr_records" ("cdrAt" DESC) WHERE "enriched_at" IS NULL;
