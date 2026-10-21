-- Parking FreeRADIUS calls.log. New tables only. CDR and syslog rows stay.

CREATE TABLE "parking_ssh_secrets" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "private_key_ciphertext" TEXT,
    "key_fingerprint" TEXT,
    "key_algo" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parking_ssh_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "radius_ingest_states" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "inode" TEXT NOT NULL DEFAULT '',
    "byte_offset" BIGINT NOT NULL DEFAULT 0,
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "pending" BYTEA NOT NULL DEFAULT '\x'::bytea,
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "radius_ingest_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "radius_ingest_gaps" (
    "id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "from_offset" BIGINT NOT NULL,
    "to_offset" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "radius_ingest_gaps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "radius_ingest_gaps_created_at_idx" ON "radius_ingest_gaps"("created_at");

CREATE TABLE "radius_calls" (
    "id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "byte_offset" BIGINT NOT NULL,
    "logged_at" TIMESTAMP(3),
    "header_raw" TEXT NOT NULL DEFAULT '',
    "packet_type" TEXT NOT NULL DEFAULT '',
    "call_origin" TEXT NOT NULL DEFAULT '',
    "user_name" TEXT NOT NULL DEFAULT '',
    "calling_station_id" TEXT NOT NULL DEFAULT '',
    "called_station_id" TEXT NOT NULL DEFAULT '',
    "src_number_out" TEXT NOT NULL DEFAULT '',
    "dst_number_out" TEXT NOT NULL DEFAULT '',
    "in_trunk" TEXT NOT NULL DEFAULT '',
    "out_trunk" TEXT NOT NULL DEFAULT '',
    "remote_id" TEXT NOT NULL DEFAULT '',
    "src_ip" TEXT NOT NULL DEFAULT '',
    "acct_session_id" TEXT NOT NULL DEFAULT '',
    "attrs" JSONB NOT NULL,
    "raw" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "radius_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "radius_calls_generation_byte_offset_key" ON "radius_calls"("generation", "byte_offset");
CREATE INDEX "radius_calls_logged_at_idx" ON "radius_calls"("logged_at");
