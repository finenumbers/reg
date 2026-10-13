/**
 * In-process FTP listener for softswitch CDR uploads.
 * Singleton on globalThis — Next.js duplicates module instances.
 */

import { FtpSrv } from "ftp-srv";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import { ensureCdrInbox } from "@/modules/traffic/paths";

const FTP_GLOBAL_KEY = "__reg_ftp_server__";

export type FtpBind = {
  globalKey: string;
  greeting: string;
  logScope: string;
  ensureInbox: () => string;
  loadConfig: () => Promise<FtpRuntimeConfig | null>;
  onStored: () => void;
  disabledDetail: string;
  missingCredentialsDetail: string;
};

const FTP_WHITELIST = [
  "USER",
  "PASS",
  "SYST",
  "FEAT",
  "PWD",
  "CWD",
  "TYPE",
  "PASV",
  "EPSV",
  "PORT",
  "EPRT",
  "STOR",
  "QUIT",
  "NOOP",
  "LIST",
  "NLST",
  "SIZE",
  "MDTM",
];

type FtpGlobalState = {
  server: FtpSrv | null;
  listening: boolean;
};

function ftpState(globalKey: string): FtpGlobalState {
  const g = globalThis as typeof globalThis & {
    [key: string]: FtpGlobalState | undefined;
  };
  if (!g[globalKey]) {
    g[globalKey] = { server: null, listening: false };
  }
  return g[globalKey];
}

export function isBoundFtpActive(globalKey: string): boolean {
  return ftpState(globalKey).listening;
}

export function isFtpListenerActive(): boolean {
  return isBoundFtpActive(FTP_GLOBAL_KEY);
}

export type FtpRuntimeConfig = {
  enabled: boolean;
  username: string;
  password: string;
  listenPort: number;
  pasvMinPort: number;
  pasvMaxPort: number;
  pasvAddress: string | null;
};

export async function loadFtpRuntimeConfig(): Promise<FtpRuntimeConfig | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (!settings) return null;
  let password = "";
  if (settings.ftpPasswordCiphertext) {
    try {
      const encryption = getSecretEncryptionService();
      password = encryption.decrypt(
        deserializeEncryptedSecret(settings.ftpPasswordCiphertext),
      );
    } catch (error) {
      logger.error("ftp.password_decrypt_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return {
    enabled: settings.ftpEnabled,
    username: settings.ftpUsername?.trim() ?? "",
    password,
    listenPort: settings.ftpListenPort,
    pasvMinPort: settings.ftpPasvMinPort,
    pasvMaxPort: settings.ftpPasvMaxPort,
    pasvAddress: settings.ftpPasvAddress?.trim() || null,
  };
}

export async function stopBoundFtp(globalKey: string): Promise<void> {
  const state = ftpState(globalKey);
  const server = state.server;
  state.server = null;
  state.listening = false;
  if (!server) return;
  try {
    await server.close();
  } catch (error) {
    logger.warn(`${globalKey}.stop_failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function stopFtpServer(): Promise<void> {
  await stopBoundFtp(FTP_GLOBAL_KEY);
}

export async function startBoundFtp(
  bind: FtpBind,
): Promise<{ started: boolean; detail: string }> {
  const config = await bind.loadConfig();
  if (!config) {
    await stopBoundFtp(bind.globalKey);
    return { started: false, detail: "Настройки FTP недоступны" };
  }
  if (!config.enabled) {
    await stopBoundFtp(bind.globalKey);
    return { started: false, detail: bind.disabledDetail };
  }
  if (!config.username || !config.password) {
    await stopBoundFtp(bind.globalKey);
    return { started: false, detail: bind.missingCredentialsDetail };
  }

  await stopBoundFtp(bind.globalKey);
  const inbox = bind.ensureInbox();
  const server = new FtpSrv({
    url: `ftp://0.0.0.0:${config.listenPort}`,
    pasv_min: config.pasvMinPort,
    pasv_max: config.pasvMaxPort,
    ...(config.pasvAddress ? { pasv_url: config.pasvAddress } : {}),
    anonymous: false,
    whitelist: FTP_WHITELIST,
    greeting: bind.greeting,
  });

  server.on("login", ({ connection, username, password }, resolve, reject) => {
    if (username !== config.username || password !== config.password) {
      reject(new Error("Invalid credentials"));
      return;
    }
    connection.on("STOR", (error: Error | null) => {
      if (error) {
        logger.warn(`${bind.logScope}.stor_failed`, { error: error.message });
        return;
      }
      bind.onStored();
    });
    resolve({ root: inbox });
  });

  server.on("client-error", ({ error }) => {
    logger.warn(`${bind.logScope}.client_error`, { error: error.message });
  });

  try {
    await server.listen();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`${bind.logScope}.listen_failed`, { error: detail });
    return { started: false, detail };
  }

  const state = ftpState(bind.globalKey);
  state.server = server;
  state.listening = true;
  logger.info(`${bind.logScope}.listening`, {
    port: config.listenPort,
    pasv: `${config.pasvMinPort}-${config.pasvMaxPort}`,
    pasvAddress: config.pasvAddress,
  });
  return {
    started: true,
    detail: `FTP слушает 0.0.0.0:${config.listenPort}`,
  };
}

const RTU_FTP_BIND: FtpBind = {
  globalKey: FTP_GLOBAL_KEY,
  greeting: "Reg CDR inbox",
  logScope: "ftp",
  ensureInbox: () => ensureCdrInbox(),
  loadConfig: () => loadFtpRuntimeConfig(),
  onStored: () => requestCdrImportDrain("schedule"),
  disabledDetail: "FTP выключен в Настройках",
  missingCredentialsDetail: "Задайте логин и пароль FTP в Настройках",
};

export async function startFtpServer(): Promise<{
  started: boolean;
  detail: string;
}> {
  return startBoundFtp(RTU_FTP_BIND);
}

export async function restartFtpServer(): Promise<{
  started: boolean;
  detail: string;
}> {
  return startFtpServer();
}

export async function testFtpListener(): Promise<{
  result: "success" | "error";
  detail: string;
}> {
  const config = await loadFtpRuntimeConfig();
  if (!config) {
    return { result: "error", detail: "Настройки FTP недоступны" };
  }
  if (!config.enabled) {
    return { result: "error", detail: "FTP выключен" };
  }
  if (!config.username || !config.password) {
    return { result: "error", detail: "Не заданы логин или пароль FTP" };
  }
  if (isFtpListenerActive()) {
    return {
      result: "success",
      detail: `Слушатель активен на порту ${config.listenPort}`,
    };
  }
  const started = await startFtpServer();
  return {
    result: started.started ? "success" : "error",
    detail: started.detail,
  };
}
