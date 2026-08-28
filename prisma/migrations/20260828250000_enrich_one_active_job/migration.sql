-- At most one queued/running enrich job (survives process restart).
CREATE UNIQUE INDEX "enrich_jobs_one_active" ON "enrich_jobs" ((true))
WHERE status IN ('queued', 'running');
