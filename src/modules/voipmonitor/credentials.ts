import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";

export type VoipmonitorRuntimeConfig = {
  enabled: boolean;
  ready: boolean;
  apiUrl: string;
  user: string;
  password: string;
  guiUrl: string;
};

export async function loadVoipmonitorRuntime(): Promise<VoipmonitorRuntimeConfig> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const apiUrl = settings?.voipmonitorApiUrl?.trim() ?? "";
  const user = settings?.voipmonitorUser?.trim() ?? "";
  const guiUrl = settings?.voipmonitorGuiUrl?.trim() ?? "";
  let password = "";
  if (settings?.voipmonitorPasswordCiphertext) {
    try {
      const encryption = getSecretEncryptionService();
      password = encryption.decrypt(
        deserializeEncryptedSecret(settings.voipmonitorPasswordCiphertext),
      );
    } catch {
      password = "";
    }
  }
  const enabled = Boolean(settings?.voipmonitorEnabled);
  const ready = enabled && Boolean(apiUrl && user && password && guiUrl);
  return { enabled, ready, apiUrl, user, password, guiUrl };
}
