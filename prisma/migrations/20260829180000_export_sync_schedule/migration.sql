-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "exportSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN "exportSyncIntervalSec" INTEGER NOT NULL DEFAULT 300;
