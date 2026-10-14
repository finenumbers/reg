-- Syslog receiver switch and the allow-list of SMG source addresses.
ALTER TABLE "app_settings" ADD COLUMN "syslog_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "smg_syslog_nodes" (
    "ip" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smg_syslog_nodes_pkey" PRIMARY KEY ("ip")
);

CREATE UNIQUE INDEX "smg_syslog_nodes_name_key" ON "smg_syslog_nodes"("name");
