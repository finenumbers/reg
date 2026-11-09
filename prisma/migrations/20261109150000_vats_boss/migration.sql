ALTER TABLE "app_settings" ADD COLUMN "vatsBossBaseUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "vatsBossLogin" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "vatsBossPasswordCiphertext" TEXT;

CREATE TABLE "vats_name_lists" (
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vats_name_lists_pkey" PRIMARY KEY ("kind")
);
