/**
 * Code-owned allowlist of local jobs.
 * Clients may only pass action codes — never paths, argv, or shell commands.
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

export type AllowedActionDefinition = {
  code: AllowedActionCode;
  module: "registrations" | "phones" | "groups" | "traffic" | "smg";
  description: string;
};

/**
 * Production allowlist. Adding a job requires a code release and a baseline update.
 */
export const ACTION_REGISTRY: Record<AllowedActionCode, AllowedActionDefinition> = {
  "regs.poll": {
    code: "regs.poll",
    module: "registrations",
    description: "Read SIP registrations from the RTU API",
  },
  "phones.sync": {
    code: "phones.sync",
    module: "phones",
    description: "Read phone endpoints and gateways from the RTU API",
  },
  "groups.sync": {
    code: "groups.sync",
    module: "groups",
    description: "Read incoming groups from the RTU API",
  },
  "cdr.import": {
    code: "cdr.import",
    module: "traffic",
    description: "Import softswitch CDR files from the local FTP inbox",
  },
  "smg.import": {
    code: "smg.import",
    module: "smg",
    description: "Import Eltex SMG CDR files from the local FTP inbox",
  },
  "voipmonitor.match": {
    code: "voipmonitor.match",
    module: "traffic",
    description: "Correlate CDR rows with VoIPmonitor and store deep-links",
  },
  "cdr.sides.refresh": {
    code: "cdr.sides.refresh",
    module: "traffic",
    description: "Refresh CDR side A/B labels from the phones catalog",
  },
  "cdr.purge.month": {
    code: "cdr.purge.month",
    module: "traffic",
    description: "Delete the oldest complete CDR calendar month",
  },
  "cdr.tariff.rate": {
    code: "cdr.tariff.rate",
    module: "traffic",
    description: "Recompute CDR direction, price, and charge from the tariff snapshot",
  },
  "db.vacuum": {
    code: "db.vacuum",
    module: "traffic",
    description: "VACUUM FULL cdr_voipmonitor_links, cdr_records, and smg_cdr_records",
  },
};
