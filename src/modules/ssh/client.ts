/**
 * SSH client — authentication and session test.
 *
 * The connection test checks reachability, authentication, and session
 * establishment. It does not send a command.
 */

import { Client, type ConnectConfig } from "ssh2";

export type SshConnectionConfig = {
  host: string;
  port: number;
  username: string;
  /** Decrypted private key PEM/OpenSSH — never log or persist after use */
  privateKeyPem: string;
};

export type SshConnectionTestOutcome = {
  result: "success" | "auth_error" | "timeout" | "error";
  detail: string;
  durationMs: number;
};

export interface SshClient {
  /**
   * Auth + session establishment only (connection test).
   * Does not execute a remote command.
   */
  testConnection(
    connection: SshConnectionConfig,
    timeoutMs?: number,
  ): Promise<SshConnectionTestOutcome>;
}

const DEFAULT_TEST_TIMEOUT_MS = 15_000;

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
}

export const sshClient: SshClient = new Ssh2Client();
