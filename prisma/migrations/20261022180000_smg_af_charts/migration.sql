-- Delay samples for the antifraud chart. NULL means not computed.
-- The migration does not fill the arrays.
ALTER TABLE "smg_call_traces" ADD COLUMN "af_ms_dev" INTEGER[],
ADD COLUMN "af_ms_prod" INTEGER[],
ADD COLUMN "af_ms_parking" INTEGER[];

-- Answers and delay charts range on setup_time. A plain CREATE INDEX blocks writes
-- on smg_cdr_records until it finishes and does not rewrite rows.
CREATE INDEX "smg_cdr_records_setup_time_idx" ON "smg_cdr_records"("setup_time");

-- CDR clock of each syslog gateway. Default UTC until the operator sets the real zone.
ALTER TABLE "smg_syslog_nodes" ADD COLUMN "cdr_timezone" TEXT NOT NULL DEFAULT 'UTC';
