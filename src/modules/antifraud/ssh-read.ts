import { Client, type ConnectConfig } from "ssh2";
import {
  assertParkingCommand,
  buildReadCommand,
  statCommand,
} from "@/modules/antifraud/commands";
import { PARKING_PORT, READ_CHUNK_BYTES } from "@/modules/antifraud/constants";
import { acceptParkingHostKey } from "@/modules/antifraud/host-key";
import type {
  ParkingHost,
  ParkingLogPath,
  ParkingUser,
} from "@/modules/antifraud/target";

const CONNECT_TIMEOUT_MS = 15_000;
const EXEC_TIMEOUT_MS = 30_000;
const MAX_STDOUT = READ_CHUNK_BYTES + 64;

export type RemoteRead = {
  stdout: Buffer;
  stderr: string;
  code: number | null;
};

export class ParkingSshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParkingSshError";
  }
}

export type ParkingLogin = {
  host: ParkingHost;
  username: ParkingUser;
  privateKeyPem: string;
};

function assertAllowedCommand(command: string): void {
  try {
    assertParkingCommand(command);
  } catch {
    throw new ParkingSshError("Команда отклонена");
  }
}

function execOn(client: Client, command: string): Promise<RemoteRead> {
  assertAllowedCommand(command);
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const stderrChunks: Buffer[] = [];
    const finish = (error?: Error, result?: RemoteRead) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      try {
        client.end();
      } catch {
        /* ignore */
      }
      finish(new ParkingSshError("Таймаут чтения"));
    }, EXEC_TIMEOUT_MS);

    client.exec(command, (error, stream) => {
      if (error) {
        finish(new ParkingSshError("Не удалось выполнить чтение"));
        return;
      }
      stream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += buf.length;
        if (stdoutBytes > MAX_STDOUT) {
          stream.destroy();
          finish(new ParkingSshError("Ответ больше одной порции"));
          return;
        }
        stdoutChunks.push(buf);
      });
      stream.stderr.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("close", (code: number | null) => {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(0, 200);
        if (code !== 0) {
          finish(new ParkingSshError(stderr.trim() || "Чтение завершилось с ошибкой"));
          return;
        }
        finish(undefined, {
          stdout: Buffer.concat(stdoutChunks),
          stderr,
          code,
        });
      });
    });
  });
}

/**
 * One SSH session to parking. Commands are the stat and dd reads only.
 * The host key must match the pinned fingerprint.
 */
export async function withParkingConnection<T>(
  login: ParkingLogin,
  fn: (exec: (command: string) => Promise<RemoteRead>) => Promise<T>,
): Promise<T> {
  const client = new Client();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let hostRejected = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
        finish(new ParkingSshError("Таймаут соединения"));
      }, CONNECT_TIMEOUT_MS);
      client.on("ready", () => finish());
      client.on("error", () =>
        finish(
          new ParkingSshError(
            hostRejected ? "Ключ хоста не совпал" : "SSH-соединение не установлено",
          ),
        ),
      );
      const config = {
        host: login.host,
        port: PARKING_PORT,
        username: login.username,
        privateKey: login.privateKeyPem,
        readyTimeout: CONNECT_TIMEOUT_MS,
        tryKeyboard: false,
        agent: undefined,
        hostVerifier: (key: Buffer) => {
          const accepted = acceptParkingHostKey(key);
          if (!accepted) hostRejected = true;
          return accepted;
        },
      } as ConnectConfig;
      try {
        client.connect(config);
      } catch {
        finish(new ParkingSshError("SSH-соединение не установлено"));
      }
    });
    return await fn((command) => execOn(client, command));
  } finally {
    try {
      client.end();
    } catch {
      /* ignore */
    }
  }
}

export async function readCallsStat(
  exec: (command: string) => Promise<RemoteRead>,
  logPath: ParkingLogPath,
): Promise<RemoteRead> {
  return exec(statCommand(logPath));
}

export async function readCallsChunk(
  exec: (command: string) => Promise<RemoteRead>,
  offset: bigint,
  logPath: ParkingLogPath,
): Promise<RemoteRead> {
  return exec(buildReadCommand(offset, logPath));
}
