-- Provider prices on purchased numbers. The mask price moves to "sale".
-- Metadata only: no row is rewritten. Label-free: startup must not scan cdr_records.
-- The old app writes the mask price to "purchase", so stop it before migrate.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "purchased_numbers" RENAME COLUMN "purchase" TO "sale";

ALTER TABLE "purchased_numbers" ADD COLUMN "purchase" TEXT NOT NULL DEFAULT '';

ALTER TABLE "purchased_numbers" ADD COLUMN "subscription" TEXT NOT NULL DEFAULT '';
