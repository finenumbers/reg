-- Browser auto-refresh of «География номеров». Not read by the job scheduler.
ALTER TABLE "app_settings" ADD COLUMN "numberGeographyRefreshEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "app_settings" ADD COLUMN "numberGeographyRefreshIntervalSec" INTEGER NOT NULL DEFAULT 60;
