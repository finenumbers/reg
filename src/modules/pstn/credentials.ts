/**
 * Load PSTN credentials from AppSetting. API key decrypted in-process only.
 */

import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import { resolvePstnBaseUrl, type PstnCredentials } from "@/modules/pstn/types";

export async function loadPstnCredentials(): Promise<PstnCredentials | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const cipher = settings?.pstnApiKeyCiphertext?.trim();
  if (!cipher) return null;

  const baseUrl = resolvePstnBaseUrl(settings?.pstnBaseUrl);

  try {
    const encryption = getSecretEncryptionService();
    const apiKey = encryption.decrypt(deserializeEncryptedSecret(cipher));
    if (!apiKey.trim()) return null;
    return { baseUrl, apiKey };
  } catch {
    return null;
  }
}

export async function getEnrichReadyFlags(): Promise<{
  hasPstnApiKey: boolean;
  hasGeoipApiKey: boolean;
}> {
  const settings = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { pstnApiKeyCiphertext: true, geoipApiKeyCiphertext: true },
  });
  return {
    hasPstnApiKey: Boolean(settings?.pstnApiKeyCiphertext),
    hasGeoipApiKey: Boolean(settings?.geoipApiKeyCiphertext),
  };
}
