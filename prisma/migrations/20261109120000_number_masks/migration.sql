-- Mask catalog. New tables only.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.

CREATE TABLE "number_masks" (
    "id" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "digitLength" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "abc" TEXT,
    "mask" TEXT NOT NULL,
    "maskType" TEXT,
    "premium" TEXT,
    "purchase" TEXT,

    CONSTRAINT "number_masks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "number_mask_import_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT,
    "loadedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_mask_import_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "number_masks_sortIndex_key" ON "number_masks"("sortIndex");
