-- Resolved antifraud labels on the CDR row, so traffic filters do not join every card.
-- Null af_category means the row has not been projected yet. «Нет данных» is a real value.
-- Partial indexes: norms are empty on most rows; the null index is the month probe.

ALTER TABLE "smg_cdr_records"
  ADD COLUMN "unique_tag_norm" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "radius_session_norm" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "af_category" TEXT,
  ADD COLUMN "af_status" TEXT;

CREATE INDEX "smg_cdr_records_unique_tag_norm_idx"
  ON "smg_cdr_records" ("unique_tag_norm")
  WHERE "unique_tag_norm" <> '';

CREATE INDEX "smg_cdr_records_radius_session_norm_idx"
  ON "smg_cdr_records" ("radius_session_norm")
  WHERE "radius_session_norm" <> '';

CREATE INDEX "smg_cdr_records_af_category_null_idx"
  ON "smg_cdr_records" ("device_sign", "disconnect_time")
  WHERE "af_category" IS NULL;

-- Ready at the current classifier revision. Rows stay null until the app fills them,
-- and a month with any null keeps the previous join.
INSERT INTO "smg_trace_checkpoints" ("id", "device_ip", "file_key", "size", "version", "state")
VALUES (
  'cdr_labels_revision',
  '@cdr-labels',
  '@revision',
  0,
  0,
  '{"revision":2,"done":true,"cursor":""}'::jsonb
)
ON CONFLICT ("device_ip", "file_key") DO NOTHING;
