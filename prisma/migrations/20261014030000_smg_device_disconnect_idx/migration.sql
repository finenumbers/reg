-- One gateway page filters device_sign and orders by disconnect time.
-- CREATE INDEX blocks writes on smg_cdr_records until it finishes and does not rewrite rows.
-- The single-column device_sign index is dropped after the composite exists.
CREATE INDEX "smg_cdr_records_device_sign_disconnect_time_id_idx" ON "smg_cdr_records"("device_sign", "disconnect_time" DESC, "id" DESC);

DROP INDEX "smg_cdr_records_device_sign_idx";
