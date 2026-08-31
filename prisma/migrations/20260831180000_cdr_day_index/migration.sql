-- Month stats / GROUP BY left(cdr_day, 7). List filter and DELETE stay on cdr_date.
CREATE INDEX "cdr_records_cdr_day_idx" ON "cdr_records"("cdr_day");
