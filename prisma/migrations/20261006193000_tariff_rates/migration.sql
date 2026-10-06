-- CreateTable
CREATE TABLE "tariff_rates" (
    "id" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "abc" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "tariff_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_import_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT,
    "loadedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_import_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tariff_rates_sortIndex_key" ON "tariff_rates"("sortIndex");

-- CreateIndex
CREATE INDEX "tariff_rates_abc_idx" ON "tariff_rates"("abc");

-- CreateIndex
CREATE INDEX "tariff_rates_direction_idx" ON "tariff_rates"("direction");
