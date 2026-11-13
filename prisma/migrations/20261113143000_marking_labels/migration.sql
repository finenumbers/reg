-- Marking and MAV catalog. New tables only.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.

CREATE TABLE "marking_rows" (
    "id" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "client" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "labelMts" TEXT,
    "labelMegafon" TEXT,
    "labelBeeline" TEXT,
    "labelT2" TEXT,
    "mavMts" TEXT,
    "mavMegafon" TEXT,
    "mavBeeline" TEXT,
    "mavT2" TEXT,

    CONSTRAINT "marking_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marking_import_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT,
    "loadedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marking_import_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marking_rows_sortIndex_key" ON "marking_rows"("sortIndex");

CREATE UNIQUE INDEX "marking_rows_phoneNumber_key" ON "marking_rows"("phoneNumber");
