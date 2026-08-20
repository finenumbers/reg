-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "displayTimezone" TEXT NOT NULL DEFAULT 'Europe/Moscow';

ALTER TABLE "app_settings" ALTER COLUMN "geoipBaseUrl" SET DEFAULT 'https://geoip.finenumbers.com';

UPDATE "app_settings"
SET "geoipBaseUrl" = 'https://geoip.finenumbers.com'
WHERE "geoipBaseUrl" IS NULL OR "geoipBaseUrl" = '';
