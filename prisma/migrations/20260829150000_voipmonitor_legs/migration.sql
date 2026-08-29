-- AlterTable
ALTER TABLE "cdr_voipmonitor_links" ADD COLUMN "voipmonitor_legs" JSONB;

-- Re-enrich every CDR with dual in/out links.
DELETE FROM "cdr_voipmonitor_links";
