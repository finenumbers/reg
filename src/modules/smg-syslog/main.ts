import pg from "pg";
import { appPoolOptions } from "@/lib/pg-pool";
import { logger } from "@/lib/logger";
import { offsetHoursForZone, runSyslogReceiver } from "@/modules/smg-syslog/run";
import { syslogBindPort, syslogRoot } from "@/modules/smg-syslog/paths";

/**
 * Process entry for the smg-syslog container. HTTP does not import this file.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error("smg.syslog.no_database", {});
    process.exit(1);
  }
  const pool = new pg.Pool({ ...appPoolOptions(connectionString), max: 2 });
  const stop = await runSyslogReceiver({
    port: syslogBindPort(),
    root: syslogRoot(),
    loadRegistry: async () => {
      const settings = await pool.query<{ enabled: boolean; zone: string | null }>(
        `SELECT "syslog_enabled" AS enabled, "displayTimezone" AS zone
         FROM "app_settings" WHERE id = 1`,
      );
      const nodes = await pool.query<{ ip: string }>(`SELECT ip FROM "smg_syslog_nodes"`);
      const row = settings.rows[0];
      return {
        enabled: row?.enabled ?? false,
        offsetHours: offsetHoursForZone(row?.zone),
        ips: new Set(nodes.rows.map((node) => node.ip)),
      };
    },
  });

  const shutdown = () => {
    void stop().then(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main();
