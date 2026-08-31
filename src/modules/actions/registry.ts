/**
 * Code-owned allowlist of remote actions.
 * Clients may only pass action codes — never paths, argv, or shell commands.
 */

const OPT_SCRIPTS_PATH_PATTERN = /^\/opt\/scripts\/[A-Za-z0-9._-]+$/;

export type AllowedActionCode =
  | "regs.poll"
  | "phones.sync"
  | "groups.sync"
  | "cdr.import"
  | "voipmonitor.match"
  | "cdr.sides.refresh"
  | "cdr.purge.month";

/** Absolute sudo binary used for non-interactive elevation (never from UI). */
const REMOTE_SUDO_BIN = "/usr/bin/sudo";

/**
 * Fixed elevated exec — matches interactive
 * `cd /opt/scripts && sudo ./<script>` (cwd-sensitive scripts).
 * Never built from UI input.
 */
export function buildElevatedOptScriptsCommand(remotePath: string): string {
  assertOptScriptsPath(remotePath);
  const basename = remotePath.slice("/opt/scripts/".length);
  return `/bin/bash -c 'cd /opt/scripts && exec ${REMOTE_SUDO_BIN} -n -- ./${basename}'`;
}

export type AllowedActionDefinition = {
  code: AllowedActionCode;
  kind: "ssh" | "local";
  /** Absolute path under /opt/scripts only — unused for local actions */
  remotePath: string;
  /** Always empty in v1 — no user-controlled argv */
  argv: readonly string[];
  module: "registrations" | "phones" | "groups" | "traffic";
  description: string;
  /** Remote wrapper token channel uses the same absolute path */
  usesPlatformExecWrapper: true;
  /**
   * When true, SSH exec uses fixed
   * `/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./<script>'`
   * (code constant). Requires NOPASSWD sudoers on softswitch for that script path.
   */
  elevateWithSudo: boolean;
  /** When true, ssh2 allocates a PTY (required for check_regs.sh TTY behavior). */
  needsPty: boolean;
};

/**
 * Production allowlist. Adding a new script requires a code release + seed update.
 */
export const ACTION_REGISTRY: Record<AllowedActionCode, AllowedActionDefinition> = {
  "regs.poll": {
    code: "regs.poll",
    kind: "ssh",
    remotePath: "/opt/scripts/check_regs.sh",
    argv: [],
    module: "registrations",
    description: "Poll SIP registrations from softswitch",
    usesPlatformExecWrapper: true,
    elevateWithSudo: true,
    needsPty: true,
  },
  "phones.sync": {
    code: "phones.sync",
    kind: "ssh",
    remotePath: "/opt/scripts/export.py",
    argv: [],
    module: "phones",
    description: "Sync phone endpoints/gateways from softswitch (read-only JSON)",
    usesPlatformExecWrapper: true,
    elevateWithSudo: true,
    needsPty: false,
  },
  "groups.sync": {
    code: "groups.sync",
    kind: "ssh",
    remotePath: "/opt/scripts/export.py",
    argv: [],
    module: "groups",
    description: "Sync routing groups catalog from softswitch (read-only JSON)",
    usesPlatformExecWrapper: true,
    elevateWithSudo: true,
    needsPty: false,
  },
  "cdr.import": {
    code: "cdr.import",
    kind: "local",
    remotePath: "/opt/scripts/cdr_import",
    argv: [],
    module: "traffic",
    description: "Import softswitch CDR files from the local FTP inbox",
    usesPlatformExecWrapper: true,
    elevateWithSudo: false,
    needsPty: false,
  },
  "voipmonitor.match": {
    code: "voipmonitor.match",
    kind: "local",
    remotePath: "/opt/scripts/voipmonitor_match",
    argv: [],
    module: "traffic",
    description: "Correlate CDR rows with VoIPmonitor and store deep-links",
    usesPlatformExecWrapper: true,
    elevateWithSudo: false,
    needsPty: false,
  },
  "cdr.sides.refresh": {
    code: "cdr.sides.refresh",
    kind: "local",
    remotePath: "/opt/scripts/cdr_sides_refresh",
    argv: [],
    module: "traffic",
    description: "Refresh CDR side A/B labels from the phones catalog",
    usesPlatformExecWrapper: true,
    elevateWithSudo: false,
    needsPty: false,
  },
  "cdr.purge.month": {
    code: "cdr.purge.month",
    kind: "local",
    remotePath: "/opt/scripts/cdr_purge_month",
    argv: [],
    module: "traffic",
    description: "Delete the oldest complete CDR calendar month",
    usesPlatformExecWrapper: true,
    elevateWithSudo: false,
    needsPty: false,
  },
};

export function resolveActionForExecution(code: string): AllowedActionDefinition {
  const action = getAllowedAction(code);
  if (!action) {
    throw new Error(`Unknown or disallowed action code: ${code}`);
  }
  if (action.kind === "local") {
    throw new Error(`Action ${code} is local-only and cannot be executed remotely`);
  }
  if (action.argv.length > 0) {
    throw new Error(`Action ${code} has non-empty argv — not permitted in v1`);
  }
  assertOptScriptsPath(action.remotePath);
  return action;
}

function getAllowedAction(code: string): AllowedActionDefinition | null {
  if (!(code in ACTION_REGISTRY)) return null;
  return ACTION_REGISTRY[code as AllowedActionCode];
}

export function assertOptScriptsPath(path: string): void {
  if (!OPT_SCRIPTS_PATH_PATTERN.test(path)) {
    throw new Error(`Remote path rejected: must match ${OPT_SCRIPTS_PATH_PATTERN}`);
  }
}
