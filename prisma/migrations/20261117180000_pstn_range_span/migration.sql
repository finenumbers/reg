-- Operator and geography lookup uses one GiST index.
-- btree_gist is the same contrib set as pg_trgm. The index is not in schema.prisma.
-- Does not rewrite free_numbers, purchased_numbers, or cdr_records.

SET LOCAL lock_timeout = '15s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE INDEX "pstn_range_snapshot_span_idx"
  ON "pstn_range_snapshot"
  USING gist ("abc", int4range("range_start", "range_end", '[]'));

ANALYZE "pstn_range_snapshot";
