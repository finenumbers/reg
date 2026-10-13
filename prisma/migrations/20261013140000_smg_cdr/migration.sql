-- Eltex SMG-1016M CDR inbox settings and call table.
ALTER TABLE "app_settings" ADD COLUMN "smgFtpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpUsername" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpPasswordCiphertext" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpListenPort" INTEGER NOT NULL DEFAULT 2122;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpPasvMinPort" INTEGER NOT NULL DEFAULT 50110;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpPasvMaxPort" INTEGER NOT NULL DEFAULT 50119;
ALTER TABLE "app_settings" ADD COLUMN "smgFtpPasvAddress" TEXT;

CREATE TABLE "smg_cdr_records" (
    "id" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "disconnect_day" TEXT NOT NULL DEFAULT '',
    "device_sign" TEXT NOT NULL DEFAULT '',
    "setup_time" TEXT NOT NULL DEFAULT '',
    "connect_time" TEXT NOT NULL DEFAULT '',
    "disconnect_time" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "release_cause" TEXT NOT NULL DEFAULT '',
    "call_release_info" TEXT NOT NULL DEFAULT '',
    "incoming_ip" TEXT NOT NULL DEFAULT '',
    "incoming_type" TEXT NOT NULL DEFAULT '',
    "incoming_description" TEXT NOT NULL DEFAULT '',
    "outgoing_ip" TEXT NOT NULL DEFAULT '',
    "outgoing_type" TEXT NOT NULL DEFAULT '',
    "outgoing_description" TEXT NOT NULL DEFAULT '',
    "incoming_cgpn" TEXT NOT NULL DEFAULT '',
    "outgoing_cgpn" TEXT NOT NULL DEFAULT '',
    "incoming_cdpn" TEXT NOT NULL DEFAULT '',
    "outgoing_cdpn" TEXT NOT NULL DEFAULT '',
    "redirecting_mark" TEXT NOT NULL DEFAULT '',
    "pickup_mark" TEXT NOT NULL DEFAULT '',
    "release_side_mark" TEXT NOT NULL DEFAULT '',
    "incoming_ss7_cic" TEXT NOT NULL DEFAULT '',
    "incoming_sip_call_id" TEXT NOT NULL DEFAULT '',
    "outgoing_ss7_cic" TEXT NOT NULL DEFAULT '',
    "outgoing_sip_call_id" TEXT NOT NULL DEFAULT '',
    "incoming_ss7_category" TEXT NOT NULL DEFAULT '',
    "incoming_cid_category" TEXT NOT NULL DEFAULT '',
    "outgoing_ss7_category" TEXT NOT NULL DEFAULT '',
    "outgoing_cid_category" TEXT NOT NULL DEFAULT '',
    "incoming_e1_stream" TEXT NOT NULL DEFAULT '',
    "incoming_e1_channel" TEXT NOT NULL DEFAULT '',
    "outgoing_e1_stream" TEXT NOT NULL DEFAULT '',
    "outgoing_e1_channel" TEXT NOT NULL DEFAULT '',
    "sequence_number" TEXT NOT NULL DEFAULT '',
    "incoming_redirecting_number" TEXT NOT NULL DEFAULT '',
    "outgoing_redirecting_number" TEXT NOT NULL DEFAULT '',
    "radius_session_id" TEXT NOT NULL DEFAULT '',
    "global_callref" TEXT NOT NULL DEFAULT '',
    "incoming_numplan" TEXT NOT NULL DEFAULT '',
    "outgoing_numplan" TEXT NOT NULL DEFAULT '',
    "unique_tag" TEXT NOT NULL DEFAULT '',
    "calling_nai" TEXT NOT NULL DEFAULT '',
    "called_nai" TEXT NOT NULL DEFAULT '',
    "incoming_redirecting_nai" TEXT NOT NULL DEFAULT '',
    "outgoing_redirecting_nai" TEXT NOT NULL DEFAULT '',
    "call_transfer_mark" TEXT NOT NULL DEFAULT '',
    "call_record_path" TEXT NOT NULL DEFAULT '',
    "ivr_call_record_path" TEXT NOT NULL DEFAULT '',
    "rejecting_radius_address" TEXT NOT NULL DEFAULT '',
    "calling_nai_original" TEXT NOT NULL DEFAULT '',
    "called_nai_original" TEXT NOT NULL DEFAULT '',
    "time_in_queue" TEXT NOT NULL DEFAULT '',
    "redirection_type" TEXT NOT NULL DEFAULT '',
    "source_filename" TEXT NOT NULL DEFAULT '',
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_job_run_id" TEXT,

    CONSTRAINT "smg_cdr_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "smg_cdr_records_record_key_key" ON "smg_cdr_records"("record_key");
CREATE INDEX "smg_cdr_records_disconnect_day_idx" ON "smg_cdr_records"("disconnect_day");
CREATE INDEX "smg_cdr_records_device_sign_idx" ON "smg_cdr_records"("device_sign");
CREATE INDEX "smg_cdr_records_incoming_cgpn_idx" ON "smg_cdr_records"("incoming_cgpn");
CREATE INDEX "smg_cdr_records_outgoing_cgpn_idx" ON "smg_cdr_records"("outgoing_cgpn");
CREATE INDEX "smg_cdr_records_incoming_cdpn_idx" ON "smg_cdr_records"("incoming_cdpn");
CREATE INDEX "smg_cdr_records_outgoing_cdpn_idx" ON "smg_cdr_records"("outgoing_cdpn");
CREATE INDEX "smg_cdr_records_last_job_run_id_idx" ON "smg_cdr_records"("last_job_run_id");

ALTER TABLE "smg_cdr_records" ADD CONSTRAINT "smg_cdr_records_last_job_run_id_fkey" FOREIGN KEY ("last_job_run_id") REFERENCES "job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
