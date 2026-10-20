-- Labels for the SMG traffic filters. Null means the card has not been classified yet.
-- The app fills nulls in batches and writes both columns on every later save.
ALTER TABLE "smg_call_traces" ADD COLUMN "af_category" TEXT,
ADD COLUMN "af_status" TEXT;
