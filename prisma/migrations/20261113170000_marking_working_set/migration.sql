-- Marking labels stay keyed by phone. The file order is no longer unique.
-- The on-switch index serves the marking read. Screen publish recreates it:
-- LIKE INCLUDING DEFAULTS does not copy indexes.
-- Does not rewrite phone, tariff, CDR, or PSTN rows.
-- Does not replace the rater or geography functions.
-- Label-free: startup must not scan cdr_records.

DROP INDEX "marking_rows_sortIndex_key";

CREATE INDEX "rtu_screen_on_switch_idx"
  ON "rtu_screen" ("number", "id")
  INCLUDE ("client", "pstnKey")
  WHERE NOT missing;
