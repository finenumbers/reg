/**
 * SSH client — auth/session test + allowlisted remote exec (Phase 4).
 *
 * Connection test: reachability + authentication + session only (no script exec).
 * Allowlisted exec: ssh2.exec of a code-owned command under /opt/scripts/
 * (via `/usr/bin/sudo -n --` when elevateWithSudo). PTY is allocated only when
 * action.needsPty is true (e.g. check_regs.sh). Never accepts arbitrary commands from UI/API.
 */

import { Client, type ConnectConfig } from "ssh2";
import type { RemoteExecutionResult } from "@/modules/actions/execution";
import {
  assertOptScriptsPath,
  buildElevatedOptScriptsCommand,
  type AllowedActionDefinition,
} from "@/modules/actions/registry";

export type SshConnectionConfig = {
  host: string;
  port: number;
  username: string;
  /** Decrypted private key PEM/OpenSSH — never log or persist after use */
  privateKeyPem: string;
};

export type SshExecOptions = {
  action: AllowedActionDefinition;
  timeoutMs: number;
};

export type SshConnectionTestOutcome = {
  result: "success" | "auth_error" | "timeout" | "error";
  detail: string;
  durationMs: number;
};

export interface SshClient {
  /**
   * Auth + session establishment only (connection test).
   * Does not execute remote scripts.
   */
  testConnection(
    connection: SshConnectionConfig,
    timeoutMs?: number,
  ): Promise<SshConnectionTestOutcome>;

  /**
   * Execute exactly one allowlisted remote action via ssh2 exec.
   * PTY is allocated only when action.needsPty is true.
   * Command string is constructed from the allowlist definition only.
   */
  execAllowlisted(
    connection: SshConnectionConfig,
    options: SshExecOptions,
  ): Promise<RemoteExecutionResult>;
}

const DEFAULT_TEST_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

function classifySshError(error: unknown): {
  result: "auth_error" | "timeout" | "error";
  detail: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("etimedout")
  ) {
    return { result: "timeout", detail: "SSH connection timed out" };
  }
  if (
    lower.includes("authentication") ||
    lower.includes("all configured authentication methods failed") ||
    lower.includes("permission denied") ||
    lower.includes("no matching") ||
    lower.includes("encrypted private key") ||
    lower.includes("cannot parse private key")
  ) {
    return {
      result: "auth_error",
      detail: "SSH authentication failed — check username and private key",
    };
  }
  if (lower.includes("econnrefused") || lower.includes("enotfound")) {
    return {
      result: "error",
      detail: "Could not reach SSH host (connection refused or DNS failure)",
    };
  }
  // Never echo raw node/ssh2 internals that might leak paths.
  return { result: "error", detail: "SSH connection failed" };
}

/**
 * Build the remote command string solely from the allowlisted action.
 * Defense-in-depth: re-validate path; reject non-empty argv / shell operators.
 * When elevateWithSudo: fixed
 * `/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./<script>'`
 * so cwd matches interactive `sudo ./check_regs.sh` (never from UI).
 */
export function buildAllowlistedExecCommand(
  action: AllowedActionDefinition,
): string {
  assertOptScriptsPath(action.remotePath);
  if (action.argv.length > 0) {
    throw new Error(
      `Action ${action.code} has non-empty argv — not permitted in v1`,
    );
  }
  if (/[;&|`$<>\\]/.test(action.remotePath)) {
    throw new Error("Remote path rejected: shell metacharacters not allowed");
  }
  if (action.elevateWithSudo) {
    return buildElevatedOptScriptsCommand(action.remotePath);
  }
  return action.remotePath;
}

export class Ssh2Client implements SshClient {
  async testConnection(
    connection: SshConnectionConfig,
    timeoutMs: number = DEFAULT_TEST_TIMEOUT_MS,
  ): Promise<SshConnectionTestOutcome> {
    const started = Date.now();

    return new Promise((resolve) => {
      const client = new Client();
      let settled = false;

      const finish = (outcome: SshConnectionTestOutcome) => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {
          /* ignore */
        }
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
        finish({
          result: "timeout",
          detail: "SSH connection timed out",
          durationMs: Date.now() - started,
        });
      }, timeoutMs);

      client.on("ready", () => {
        clearTimeout(timer);
        finish({
          result: "success",
          detail: "SSH authentication succeeded",
          durationMs: Date.now() - started,
        });
      });

      client.on("error", (err) => {
        clearTimeout(timer);
        const classified = classifySshError(err);
        finish({
          ...classified,
          durationMs: Date.now() - started,
        });
      });

      const config: ConnectConfig = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        privateKey: connection.privateKeyPem,
        readyTimeout: Math.min(timeoutMs, 30_000),
        tryKeyboard: false,
        agent: undefined,
      };

      try {
        client.connect(config);
      } catch (error) {
        clearTimeout(timer);
        const classified = classifySshError(error);
        finish({
          ...classified,
          durationMs: Date.now() - started,
        });
      }
    });
  }

  async execAllowlisted(
    connection: SshConnectionConfig,
    options: SshExecOptions,
  ): Promise<RemoteExecutionResult> {
    const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_EXEC_TIMEOUT_MS;
    const command = buildAllowlistedExecCommand(options.action);
    const started = Date.now();

    return new Promise((resolve) => {
      const client = new Client();
      let settled = false;
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      let timedOut = false;

      const finish = (result: RemoteExecutionResult) => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      const failSafe = (detail: string, code: number | null = null) => {
        finish({
          actionCode: options.action.code,
          remotePath: options.action.remotePath,
          exitCode: code,
          stdout,
          stderr: stderr || detail,
          durationMs: Date.now() - started,
          timedOut,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
        finish({
          actionCode: options.action.code,
          remotePath: options.action.remotePath,
          exitCode: null,
          stdout,
          stderr: stderr || "SSH exec timed out",
          durationMs: Date.now() - started,
          timedOut: true,
        });
      }, timeoutMs);

      client.on("ready", () => {
        // PTY only when needed (check_regs.sh). Softswitch authorized_keys
        // must not set no-pty for the platform key when regs.poll is used.
        const execOpts = options.action.needsPty ? { pty: true as const } : {};
        client.exec(command, execOpts, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            const classified = classifySshError(err);
            failSafe(classified.detail);
            return;
          }

          stream.on("data", (data: Buffer | string) => {
            stdout += data.toString();
          });
          // With PTY, stderr is usually merged into stdout; attach if present.
          stream.stderr?.on("data", (data: Buffer | string) => {
            stderr += data.toString();
          });
          stream.on("close", (code: number | null) => {
            clearTimeout(timer);
            exitCode = typeof code === "number" ? code : null;
            finish({
              actionCode: options.action.code,
              remotePath: options.action.remotePath,
              exitCode,
              stdout,
              stderr,
              durationMs: Date.now() - started,
              timedOut: false,
            });
          });
        });
      });

      client.on("error", (err) => {
        if (settled) return;
        clearTimeout(timer);
        const classified = classifySshError(err);
        failSafe(classified.detail);
      });

      const config: ConnectConfig = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        privateKey: connection.privateKeyPem,
        readyTimeout: Math.min(timeoutMs, 30_000),
        tryKeyboard: false,
        agent: undefined,
      };

      try {
        client.connect(config);
      } catch (error) {
        clearTimeout(timer);
        const classified = classifySshError(error);
        failSafe(classified.detail);
      }
    });
  }
}

export const sshClient: SshClient = new Ssh2Client();
