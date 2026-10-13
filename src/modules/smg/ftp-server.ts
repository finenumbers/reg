/**
 * In-process FTP listener for Eltex SMG CDR uploads.
 * Separate global key and inbox from the softswitch listener.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requestSmgImportDrain } from "@/modules/smg/enqueue";
import { ensureSmgInbox } from "@/modules/smg/paths";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import {
  isBoundFtpActive,
  loadFtpRuntimeConfig,
  startBoundFtp,
  stopBoundFtp,
  type FtpBind,
  type FtpRuntimeConfig,
} from "@/modules/traffic/ftp-server";

export const SMG_FTP_GLOBAL_KEY = "__reg_smg_ftp_server__";

export function isSmgFtpListenerActive(): boolean {
  return isBoundFtpActive(SMG_FTP_GLOBAL_KEY);
}

export async function loadSmgFtpRuntimeConfig(): Promise<FtpRuntimeConfig | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (!settings) return null;
  let password = "";
  if (settings.smgFtpPasswordCiphertext) {
    try {
      const encryption = getSecretEncryptionService();
      password = encryption.decrypt(
        deserializeEncryptedSecret(settings.smgFtpPasswordCiphertext),
      );
    } catch (error) {
      logger.error("smg.ftp.password_decrypt_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return {
    enabled: settings.smgFtpEnabled,
    username: settings.smgFtpUsername?.trim() ?? "",
    password,
    listenPort: settings.smgFtpListenPort,
    pasvMinPort: settings.smgFtpPasvMinPort,
    pasvMaxPort: settings.smgFtpPasvMaxPort,
    pasvAddress: settings.smgFtpPasvAddress?.trim() || null,
  };
}

const SMG_FTP_BIND: FtpBind = {
  globalKey: SMG_FTP_GLOBAL_KEY,
  greeting: "Reg SMG CDR inbox",
  logScope: "smg.ftp",
  ensureInbox: () => ensureSmgInbox(),
  loadConfig: () => loadSmgFtpRuntimeConfig(),
  onStored: () => requestSmgImportDrain("schedule"),
  disabledDetail: "FTP SMG выключен в Настройках",
  missingCredentialsDetail: "Задайте логин и пароль FTP SMG в Настройках",
};

export async function startSmgFtpServer(): Promise<{
  started: boolean;
  detail: string;
}> {
  const [smg, rtu] = await Promise.all([
    loadSmgFtpRuntimeConfig(),
    loadFtpRuntimeConfig(),
  ]);
  if (smg?.enabled && rtu && smg.listenPort === rtu.listenPort) {
    await stopBoundFtp(SMG_FTP_GLOBAL_KEY);
    return {
      started: false,
      detail: "Порт FTP SMG совпадает с портом FTP телефонного трафика",
    };
  }
  return startBoundFtp(SMG_FTP_BIND);
}

export async function restartSmgFtpServer(): Promise<{
  started: boolean;
  detail: string;
}> {
  return startSmgFtpServer();
}

export async function testSmgFtpListener(): Promise<{
  result: "success" | "error";
  detail: string;
}> {
  const config = await loadSmgFtpRuntimeConfig();
  if (!config) {
    return { result: "error", detail: "Настройки FTP SMG недоступны" };
  }
  if (!config.enabled) {
    return { result: "error", detail: "FTP SMG выключен" };
  }
  if (!config.username || !config.password) {
    return { result: "error", detail: "Не заданы логин или пароль FTP SMG" };
  }
  const rtu = await loadFtpRuntimeConfig();
  if (rtu && config.listenPort === rtu.listenPort) {
    return {
      result: "error",
      detail: "Порт FTP SMG совпадает с портом FTP телефонного трафика",
    };
  }
  if (isSmgFtpListenerActive()) {
    return {
      result: "success",
      detail: `Слушатель активен на порту ${config.listenPort}`,
    };
  }
  const started = await startSmgFtpServer();
  return {
    result: started.started ? "success" : "error",
    detail: started.detail,
  };
}
