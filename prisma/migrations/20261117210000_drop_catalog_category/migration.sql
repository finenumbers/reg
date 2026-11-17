-- «Категория» leaves the two number catalogs. Rows and the CDR journal stay.
-- The old app still inserts this column, so stop it before migrate.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "free_numbers" DROP COLUMN "category";
ALTER TABLE "purchased_numbers" DROP COLUMN "category";
