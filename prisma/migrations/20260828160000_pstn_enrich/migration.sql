-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "pstnBaseUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "pstnApiKeyCiphertext" TEXT;

-- AlterTable
ALTER TABLE "ip_geo_cache" ADD COLUMN "countryIso" TEXT;

-- CreateTable
CREATE TABLE "pstn_phone_cache" (
    "phone" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "operator" TEXT,
    "garTerritory" TEXT,
    "lookedUpAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pstn_phone_cache_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE INDEX "pstn_phone_cache_lookedUpAt_idx" ON "pstn_phone_cache"("lookedUpAt");

-- CreateEnum
CREATE TYPE "EnrichJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "enrich_jobs" (
    "id" TEXT NOT NULL,
    "status" "EnrichJobStatus" NOT NULL,
    "actorUserId" TEXT,
    "sourceFilename" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrich_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrich_jobs_status_createdAt_idx" ON "enrich_jobs"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "enrich_jobs_actorUserId_createdAt_idx" ON "enrich_jobs"("actorUserId", "createdAt" DESC);
