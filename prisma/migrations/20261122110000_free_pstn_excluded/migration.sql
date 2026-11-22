-- Free numbers without a unique PSTN operator move here after decorate.
CREATE TABLE "numbering_free_pstn_excluded" (
    "provider" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "abc" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "numbering_free_pstn_excluded_pkey" PRIMARY KEY ("provider", "e164")
);

CREATE INDEX "numbering_free_pstn_excluded_provider_idx"
  ON "numbering_free_pstn_excluded" ("provider");

-- Chunked purge selects by id among PSTN misses.
CREATE INDEX "free_numbers_pstn_miss_idx"
  ON "free_numbers" ("id")
  WHERE "pstn_hits" IN (0, 2);
