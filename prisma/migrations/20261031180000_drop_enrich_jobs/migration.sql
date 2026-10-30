-- CSV enrich upload is gone. PSTN cache, GeoIP cache, and CDR columns stay.
DROP TABLE IF EXISTS "enrich_jobs";
DROP TYPE IF EXISTS "EnrichJobStatus";
