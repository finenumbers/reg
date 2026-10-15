import pg from "pg";
import { appPoolOptions } from "@/lib/pg-pool";
import { logger } from "@/lib/logger";
import { runSyslogReceiver } from "@/modules/smg-syslog/run";
import { syslogBindPort, syslogRoot } from "@/modules/smg-syslog/paths";

const STATEMENT_TIMEOUT_MS = 2000;

/**
 * Process entry for the smg-syslog container. HTTP does not import this file.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error("smg.syslog.no_database", {});
    process.exit(1);
  }
  const base = appPoolOptions(connectionString);
  const pool = new pg.Pool({
    ...base,
    max: 2,
    options: `${base.options} -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  });
  const stop = await runSyslogReceiver({
    port: syslogBindPort(),
    root: syslogRoot(),
    loadRegistry: async () => {
      const settings = await pool.query<{ enabled: boolean }>(
        `SELECT "syslog_enabled" AS enabled FROM "app_settings" WHERE id = 1`,
      );
      const nodes = await pool.query<{ ip: string }>(`SELECT ip FROM "smg_syslog_nodes"`);
      return {
        enabled: settings.rows[0]?.enabled ?? false,
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

void main().catch((error: unknown) => {
  logger.error("smg.syslog.start_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
