-- Optional identifier for an SMG syslog node. Existing rows stay unset.
ALTER TABLE "smg_syslog_nodes" ADD COLUMN "identifier" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "smg_syslog_nodes_identifier_key" ON "smg_syslog_nodes"("identifier");
