-- Call cards read from SMG syslog. CDR rows stay unchanged.
CREATE TABLE "smg_call_traces" (
    "id" TEXT NOT NULL,
    "device_ip" TEXT NOT NULL,
    "tag_norm" TEXT NOT NULL,
    "callref" TEXT NOT NULL DEFAULT '',
    "open" BOOLEAN NOT NULL DEFAULT true,
    "blocks" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smg_call_traces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "smg_call_traces_device_ip_tag_norm_key" ON "smg_call_traces"("device_ip", "tag_norm");
CREATE INDEX "smg_call_traces_tag_norm_idx" ON "smg_call_traces"("tag_norm");

CREATE TABLE "smg_trace_checkpoints" (
    "id" TEXT NOT NULL,
    "device_ip" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "smg_trace_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "smg_trace_checkpoints_device_ip_file_key_key" ON "smg_trace_checkpoints"("device_ip", "file_key");
