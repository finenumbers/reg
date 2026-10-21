-- Parking connection target. Defaults keep the existing cursor on calls.log.

ALTER TABLE "parking_ssh_secrets"
ADD COLUMN "host" TEXT NOT NULL DEFAULT 'parking.finenumbers.com',
ADD COLUMN "username" TEXT NOT NULL DEFAULT 'dvpershin',
ADD COLUMN "log_path" TEXT NOT NULL DEFAULT '/var/log/freeradius/calls.log';

ALTER TABLE "radius_ingest_states"
ADD COLUMN "source_path" TEXT NOT NULL DEFAULT '/var/log/freeradius/calls.log';
