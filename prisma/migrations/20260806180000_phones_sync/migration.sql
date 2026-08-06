-- CreateTable
CREATE TABLE "phone_endpoints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpointNumber" TEXT,
    "data" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastJobRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_gateways" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastJobRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_import_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "endpointCount" INTEGER NOT NULL DEFAULT 0,
    "gatewayCount" INTEGER NOT NULL DEFAULT 0,
    "headersEndpoints" JSONB NOT NULL DEFAULT '[]',
    "headersGateways" JSONB NOT NULL DEFAULT '[]',
    "lastSyncedAt" TIMESTAMP(3),
    "lastJobRunId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_import_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_endpoints_name_idx" ON "phone_endpoints"("name");

-- CreateIndex
CREATE INDEX "phone_endpoints_endpointNumber_idx" ON "phone_endpoints"("endpointNumber");

-- CreateIndex
CREATE INDEX "phone_endpoints_lastSyncedAt_idx" ON "phone_endpoints"("lastSyncedAt" DESC);

-- CreateIndex
CREATE INDEX "phone_gateways_name_idx" ON "phone_gateways"("name");

-- CreateIndex
CREATE INDEX "phone_gateways_lastSyncedAt_idx" ON "phone_gateways"("lastSyncedAt" DESC);

-- AddForeignKey
ALTER TABLE "phone_endpoints" ADD CONSTRAINT "phone_endpoints_lastJobRunId_fkey" FOREIGN KEY ("lastJobRunId") REFERENCES "job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_gateways" ADD CONSTRAINT "phone_gateways_lastJobRunId_fkey" FOREIGN KEY ("lastJobRunId") REFERENCES "job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
