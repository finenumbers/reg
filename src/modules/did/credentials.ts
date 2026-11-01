/**
 * Load DID credentials from AppSetting. Token decrypted in-process only.
 */

import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import { resolveDidBaseUrl, type DidCredentials } from "@/modules/did/types";

export async function loadDidCredentials(): Promise<DidCredentials | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const cipher = settings?.didApiTokenCiphertext?.trim();
  if (!cipher) return null;

  const baseUrl = resolveDidBaseUrl(settings?.didBaseUrl);

  try {
    const encryption = getSecretEncryptionService();
    const apiToken = encryption.decrypt(deserializeEncryptedSecret(cipher));
    if (!apiToken.trim()) return null;
    return { baseUrl, apiToken };
  } catch {
    return null;
  }
}
