import path from "node:path";

export const SYSLOG_STATUS_FILENAME = ".status.json";
export const PARTIAL_GZ_SUFFIX = ".log.gz.partial";

/** Root of the syslog volume. Override with SMG_SYSLOG_DIR. */
export function syslogRoot(cwd = process.cwd()): string {
  const configured = process.env.SMG_SYSLOG_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(cwd, "data", "smg-syslog");
}

export function statusPath(root: string): string {
  return path.join(root, SYSLOG_STATUS_FILENAME);
}

/** Host port operators type on the SMG. The process always binds 5514. */
export function syslogAdvertisePort(): string {
  const raw =
    process.env.SYSLOG_ADVERTISE_PORT?.trim() ||
    process.env.SYSLOG_PUBLISH_PORT?.trim() ||
    "514";
  if (!/^\d{1,5}$/.test(raw)) return "514";
  const port = Number(raw);
  if (port < 1 || port > 65535) return "514";
  return String(port);
}

export function syslogBindPort(): number {
  const raw = process.env.SYSLOG_BIND_PORT?.trim() || "5514";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 5514;
  return port;
}
