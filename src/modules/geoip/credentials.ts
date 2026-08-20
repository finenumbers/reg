/**
 * Load GeoIP credentials from AppSetting. API key decrypted in-process only.
 */

import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import {
  normalizeGeoipBaseUrl,
  type GeoipCredentials,
} from "@/modules/geoip/types";

export async function loadGeoipCredentials(): Promise<GeoipCredentials | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const baseRaw = settings?.geoipBaseUrl?.trim();
  const cipher = settings?.geoipApiKeyCiphertext?.trim();
  if (!baseRaw || !cipher) return null;

  let baseUrl: string;
  try {
    baseUrl = normalizeGeoipBaseUrl(baseRaw);
  } catch {
    return null;
  }

  try {
    const encryption = getSecretEncryptionService();
    const apiKey = encryption.decrypt(deserializeEncryptedSecret(cipher));
    if (!apiKey.trim()) return null;
    return { baseUrl, apiKey };
  } catch {
    return null;
  }
}
