-- Per-node antifraud exchange. Existing gateways stay on.
-- CDR rows, cards, and checkpoints are not rewritten.
ALTER TABLE "smg_syslog_nodes"
  ADD COLUMN "antifraud_enabled" BOOLEAN NOT NULL DEFAULT true;
