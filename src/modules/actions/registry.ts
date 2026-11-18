/**
 * Code-owned names of local jobs. Clients may only pass these codes,
 * never paths, argv, or shell commands.
 */

export type AllowedActionCode =
  | "regs.poll"
  | "phones.sync"
  | "groups.sync"
  | "cdr.import"
  | "smg.import"
  | "voipmonitor.match"
  | "cdr.sides.refresh"
  | "cdr.purge.month"
  | "cdr.tariff.rate"
  | "db.vacuum";
