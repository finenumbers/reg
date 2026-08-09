-- CreateTable
CREATE TABLE "routing_groups" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastJobRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_group_import_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastJobRunId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_group_import_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routing_groups_externalId_key" ON "routing_groups"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "routing_groups_name_key" ON "routing_groups"("name");

-- CreateIndex
CREATE INDEX "routing_groups_sortOrder_idx" ON "routing_groups"("sortOrder");

-- AddForeignKey
ALTER TABLE "routing_groups" ADD CONSTRAINT "routing_groups_lastJobRunId_fkey" FOREIGN KEY ("lastJobRunId") REFERENCES "job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
