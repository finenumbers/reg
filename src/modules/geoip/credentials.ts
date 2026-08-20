/**
 * Load GeoIP credentials from AppSetting. API key decrypted in-process only.
 */

import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import { resolveGeoipBaseUrl, type GeoipCredentials } from "@/modules/geoip/types";

export async function loadGeoipCredentials(): Promise<GeoipCredentials | null> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const cipher = settings?.geoipApiKeyCiphertext?.trim();
  if (!cipher) return null;

  const baseUrl = resolveGeoipBaseUrl(settings?.geoipBaseUrl);

  try {
    const encryption = getSecretEncryptionService();
    const apiKey = encryption.decrypt(deserializeEncryptedSecret(cipher));
    if (!apiKey.trim()) return null;
    return { baseUrl, apiKey };
  } catch {
    return null;
  }
}
