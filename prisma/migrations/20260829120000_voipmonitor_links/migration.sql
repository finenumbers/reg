-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "voipmonitorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN "voipmonitorApiUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "voipmonitorUser" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "voipmonitorPasswordCiphertext" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "voipmonitorGuiUrl" TEXT;

-- CreateTable
CREATE TABLE "cdr_voipmonitor_links" (
    "cdr_record_id" TEXT NOT NULL,
    "voipmonitor_url" TEXT NOT NULL DEFAULT '',
    "voipmonitor_cdr_id" TEXT NOT NULL DEFAULT '',
    "voipmonitor_call_id" TEXT NOT NULL DEFAULT '',
    "match_status" TEXT NOT NULL DEFAULT '',
    "match_method" TEXT NOT NULL DEFAULT '',
    "match_score" INTEGER NOT NULL DEFAULT 0,
    "matched_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "evidence_json" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdr_voipmonitor_links_pkey" PRIMARY KEY ("cdr_record_id")
);

-- CreateIndex
CREATE INDEX "cdr_voipmonitor_links_match_status_next_attempt_at_idx" ON "cdr_voipmonitor_links"("match_status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "cdr_voipmonitor_links" ADD CONSTRAINT "cdr_voipmonitor_links_cdr_record_id_fkey" FOREIGN KEY ("cdr_record_id") REFERENCES "cdr_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
