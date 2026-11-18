-- Host, audio, and CDR date on the Calltrace link, for the «Нет RTP» checkbox.
-- Nullable until scripts/rtp-leg-index-backfill.mjs fills them.
-- This statement does not read or update cdr_records.

SET LOCAL lock_timeout = '15s';

ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "out_host" TEXT;
ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "in_host" TEXT;
ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "out_audio" BOOLEAN;
ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "in_audio" BOOLEAN;
ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "cdr_date" TEXT;
