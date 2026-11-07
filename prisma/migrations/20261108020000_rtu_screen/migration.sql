-- Screen of «Управление РТУ». New tables only.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "rtu_screen" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "capacity" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "activation" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "missing" BOOLEAN NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "abc" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "cityAlert" BOOLEAN NOT NULL,
    "pstnKey" TEXT,

    CONSTRAINT "rtu_screen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rtu_screen_number_id_idx" ON "rtu_screen"("number", "id");
CREATE INDEX "rtu_screen_activation_idx" ON "rtu_screen"("activation");
CREATE INDEX "rtu_screen_missing_idx" ON "rtu_screen"("missing");
CREATE INDEX "rtu_screen_number_trgm_idx" ON "rtu_screen" USING gin ("number" gin_trgm_ops);

CREATE TABLE "rtu_screen_state" (
    "id" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "needsPublish" BOOLEAN NOT NULL DEFAULT false,
    "phonesSyncedAt" TIMESTAMP(3),
    "supplierRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedSupplierRevision" INTEGER NOT NULL DEFAULT 0,
    "didHash" TEXT NOT NULL DEFAULT '',
    "tariffGeneration" INTEGER NOT NULL DEFAULT 0,
    "catalogRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "rtu_screen_state_pkey" PRIMARY KEY ("id")
);

INSERT INTO "rtu_screen_state" ("id") VALUES (1);
