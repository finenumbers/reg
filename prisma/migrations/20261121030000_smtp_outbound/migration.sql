-- Outbound SMTP settings. Nullable columns, no row rewrite.
-- Label-free. Does not scan the call journal.
-- lock_timeout is 15 seconds.

SET lock_timeout = '15s';

ALTER TABLE "app_settings"
  ADD COLUMN "smtpHost" TEXT,
  ADD COLUMN "smtpPort" INTEGER,
  ADD COLUMN "smtpUsername" TEXT,
  ADD COLUMN "smtpPasswordCiphertext" TEXT,
  ADD COLUMN "smtpFrom" TEXT,
  ADD COLUMN "smtpRecipients" JSONB;

ALTER TABLE "app_settings"
  ADD CONSTRAINT "app_settings_smtpPort_check"
  CHECK ("smtpPort" IS NULL OR "smtpPort" IN (465, 587));
