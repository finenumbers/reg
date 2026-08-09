import type { AllowedActionCode } from "@/modules/actions/registry";
import {
  rejectUnsafeRemoteInput,
  validateActionCode,
} from "@/modules/actions/validation";
import { loadActiveSshPrivateKeyPem } from "@/modules/settings/service";
import { sshClient, type SshClient } from "@/modules/ssh/client";

/**
 * Result of a single allowlisted remote execution.
 * Never accepts raw shell input from callers.
 */
export type RemoteExecutionResult = {
  actionCode: AllowedActionCode;
  remotePath: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type RemoteExecutionRequest = {
  /** Must be a registered allowlist code — never a free-form command */
  actionCode: AllowedActionCode;
  /** Wall-clock timeout for SSH exec */
  timeoutMs?: number;
};

/**
 * Secure remote execution port.
 * Implementations MUST:
 * - resolve action via allowlist only
 * - use ssh2 exec without shell / PTY
 * - never accept command/scriptPath/remoteArgs from HTTP clients
 */
export interface RemoteExecutionService {
  execute(request: RemoteExecutionRequest): Promise<RemoteExecutionResult>;
}

export type RemoteExecutionDeps = {
  ssh: SshClient;
  loadCredentials: typeof loadActiveSshPrivateKeyPem;
};

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

class SshAllowlistedRemoteExecutionService implements RemoteExecutionService {
  constructor(private readonly deps: RemoteExecutionDeps = {
    ssh: sshClient,
    loadCredentials: loadActiveSshPrivateKeyPem,
  }) {}

  async execute(request: RemoteExecutionRequest): Promise<RemoteExecutionResult> {
    // Defense-in-depth: reject any smuggled free-form fields if present on a widened object.
    rejectUnsafeRemoteInput(
      request as {
        command?: unknown;
        scriptPath?: unknown;
        remoteArgs?: unknown;
      },
    );

    const action = validateActionCode(request.actionCode);
    const credentials = await this.deps.loadCredentials();
    if (!credentials) {
      throw new Error(
        "SSH profile incomplete — configure host/username and import a private key first",
      );
    }

    let privateKeyPem = credentials.privateKeyPem;
    try {
      return await this.deps.ssh.execAllowlisted(
        {
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          privateKeyPem,
        },
        {
          action,
          timeoutMs: request.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
        },
      );
    } finally {
      // Drop plaintext reference as soon as possible (GC assist).
      privateKeyPem = "";
    }
  }
}

export const remoteExecutionService: RemoteExecutionService =
  new SshAllowlistedRemoteExecutionService();
