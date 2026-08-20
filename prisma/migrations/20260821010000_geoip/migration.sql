-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "geoipBaseUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "geoipApiKeyCiphertext" TEXT;

-- CreateTable
CREATE TABLE "ip_geo_cache" (
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "isp" TEXT,
    "datasetDate" TEXT,
    "lookedUpAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_geo_cache_pkey" PRIMARY KEY ("ip")
);

-- CreateIndex
CREATE INDEX "ip_geo_cache_lookedUpAt_idx" ON "ip_geo_cache"("lookedUpAt");
