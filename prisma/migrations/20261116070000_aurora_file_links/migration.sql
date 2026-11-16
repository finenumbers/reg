-- Aurora links replace the local inbox. Catalog rows are not rewritten.
-- Does not scan cdr_records.
-- Label-free: startup must not scan cdr_records.

SET LOCAL lock_timeout = '15s';

DELETE FROM "aurora_files";

ALTER TABLE "aurora_files" DROP COLUMN "stored_name";
ALTER TABLE "aurora_files" DROP COLUMN "display_name";
ALTER TABLE "aurora_files" ADD COLUMN "url_ciphertext" TEXT NOT NULL;
