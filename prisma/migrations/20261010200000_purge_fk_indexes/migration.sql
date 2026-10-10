-- Month purge deletes job_runs by startedAt and then ON DELETE SET NULL.
-- These indexes keep that from scanning cdr_records and reg_change_events per row.
-- CREATE INDEX blocks writes on each table until it finishes. cdr_records is the large one.

CREATE INDEX "job_runs_startedAt_idx" ON "job_runs"("startedAt");

CREATE INDEX "cdr_records_lastJobRunId_idx" ON "cdr_records"("lastJobRunId");

CREATE INDEX "reg_change_events_jobRunId_idx" ON "reg_change_events"("jobRunId");

CREATE INDEX "phone_endpoints_lastJobRunId_idx" ON "phone_endpoints"("lastJobRunId");

CREATE INDEX "phone_gateways_lastJobRunId_idx" ON "phone_gateways"("lastJobRunId");

CREATE INDEX "routing_groups_lastJobRunId_idx" ON "routing_groups"("lastJobRunId");

CREATE INDEX "reg_current_lastJobRunId_idx" ON "reg_current"("lastJobRunId");

CREATE INDEX "ssh_connection_tests_jobRunId_idx" ON "ssh_connection_tests"("jobRunId");
