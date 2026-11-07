-- Length of the phone number outside the ABC. Not read by rating.
-- Nullable, no default: PostgreSQL 16 does not rewrite tariff_rates.
-- Existing rows stay empty until the next five-column upload.

ALTER TABLE "tariff_rates" ADD COLUMN "numbering" TEXT;
