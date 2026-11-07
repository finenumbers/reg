-- Purchased DID numbers for «География номеров».
-- New tables only. No CDR scan and no rewrite of phone, tariff, or PSTN rows.

CREATE TABLE "geography_did_sources" (
    "generation" INTEGER NOT NULL,
    "matchKey" TEXT NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,

    CONSTRAINT "geography_did_sources_pkey" PRIMARY KEY ("generation", "matchKey")
);

CREATE INDEX "geography_did_sources_rowId_idx" ON "geography_did_sources"("rowId");

CREATE TABLE "geography_did_state" (
    "id" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "refreshedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockedToken" TEXT,

    CONSTRAINT "geography_did_state_pkey" PRIMARY KEY ("id")
);

INSERT INTO "geography_did_state" ("id", "generation") VALUES (1, 0);
