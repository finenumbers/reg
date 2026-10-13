-- Month list orders by disconnect time. A plain CREATE INDEX blocks writes
-- on smg_cdr_records until it finishes and does not rewrite rows.
CREATE INDEX "smg_cdr_records_disconnect_time_id_idx" ON "smg_cdr_records"("disconnect_time" DESC, "id" DESC);
