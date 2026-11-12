-- Recreate number_masks so purchase sits before premium.
-- Copies every row by column name. A drifted copy raises and the transaction rolls back.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not touch number_mask_import_state.

CREATE TABLE "number_masks_next" (
    "id" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "digitLength" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "abc" TEXT,
    "mask" TEXT NOT NULL,
    "maskType" TEXT,
    "purchase" TEXT,
    "premium" TEXT,
    CONSTRAINT "number_masks_next_pkey" PRIMARY KEY ("id")
);

INSERT INTO "number_masks_next" (
    "id",
    "sortIndex",
    "digitLength",
    "category",
    "abc",
    "mask",
    "maskType",
    "purchase",
    "premium"
)
SELECT
    "id",
    "sortIndex",
    "digitLength",
    "category",
    "abc",
    "mask",
    "maskType",
    "purchase",
    "premium"
FROM "number_masks";

DO $$
DECLARE
    old_n bigint;
    new_n bigint;
    drifted bigint;
BEGIN
    SELECT count(*) INTO old_n FROM "number_masks";
    SELECT count(*) INTO new_n FROM "number_masks_next";
    IF old_n <> new_n THEN
        RAISE EXCEPTION 'number_masks row count changed';
    END IF;

    SELECT count(*) INTO drifted
    FROM "number_masks" AS o
    JOIN "number_masks_next" AS n ON n."id" = o."id"
    WHERE o."sortIndex" IS DISTINCT FROM n."sortIndex"
       OR o."digitLength" IS DISTINCT FROM n."digitLength"
       OR o."category" IS DISTINCT FROM n."category"
       OR o."abc" IS DISTINCT FROM n."abc"
       OR o."mask" IS DISTINCT FROM n."mask"
       OR o."maskType" IS DISTINCT FROM n."maskType"
       OR o."purchase" IS DISTINCT FROM n."purchase"
       OR o."premium" IS DISTINCT FROM n."premium";

    IF drifted <> 0 THEN
        RAISE EXCEPTION 'number_masks column copy drifted';
    END IF;
END $$;

DROP TABLE "number_masks";

ALTER TABLE "number_masks_next" RENAME TO "number_masks";

ALTER TABLE "number_masks" RENAME CONSTRAINT "number_masks_next_pkey" TO "number_masks_pkey";

CREATE UNIQUE INDEX "number_masks_sortIndex_key" ON "number_masks"("sortIndex");
