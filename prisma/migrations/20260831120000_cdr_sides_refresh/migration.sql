-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "cdrSidesRefreshEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "app_settings" ADD COLUMN "cdrSidesRefreshIntervalSec" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "app_settings" ADD COLUMN "cdrSidesRefreshMap" JSONB;
ALTER TABLE "app_settings" ADD COLUMN "cdrSidesRefreshCatalogAt" TIMESTAMP(3);
