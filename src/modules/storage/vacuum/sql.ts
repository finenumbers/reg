/**
 * Fixed VACUUM FULL statements. Names are constants, never request input.
 * VACUUM FULL copies live rows and swaps the file at the end of the command.
 */

export const VACUUM_TABLE_ORDER = [
  "cdr_voipmonitor_links",
  "cdr_records",
] as const;

export type VacuumTableId = (typeof VACUUM_TABLE_ORDER)[number];

export const VACUUM_TABLE_LABEL: Record<VacuumTableId, string> = {
  cdr_voipmonitor_links: "Ссылки VoIPmonitor",
  cdr_records: "Звонки",
};

export const DATABASE_VACUUM_SQL: Record<VacuumTableId, string> = {
  cdr_voipmonitor_links: "VACUUM (FULL) cdr_voipmonitor_links",
  cdr_records: "VACUUM (FULL) cdr_records",
};

export const VACUUM_STATEMENT_TIMEOUT_SQL = "SET statement_timeout = 0";
export const VACUUM_LOCK_TIMEOUT_SQL = "SET lock_timeout = '60s'";

export const DATABASE_VACUUM_CONFIRM = "СЖАТЬ";
