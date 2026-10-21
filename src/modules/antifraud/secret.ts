import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { isKeyImportError, KeyImportError } from "@/modules/ssh/errors";
import { privateKeyImportService } from "@/modules/ssh/import-key";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";
import type { ParkingKeyStatus } from "@/modules/antifraud/key-status";
import { keyReplaceSchema, type KeyReplaceInput } from "@/modules/settings/schemas";

export type { ParkingKeyStatus };

export async function getParkingKeyStatus(): Promise<ParkingKeyStatus> {
  const row = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  return {
    configured: Boolean(row?.privateKeyCiphertext),
    fingerprint: row?.keyFingerprint ?? null,
    algo: row?.keyAlgo ?? null,
  };
}

/**
 * Decrypted parking key for the in-process reader. Never log or return it from an API.
 * This is not the softswitch profile.
 */
export async function loadParkingPrivateKeyPem(): Promise<string | null> {
  const row = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  if (!row?.privateKeyCiphertext) return null;
  const encryption = getSecretEncryptionService();
  const envelope = deserializeEncryptedSecret(row.privateKeyCiphertext);
  return encryption.decrypt(envelope);
}

export async function replaceParkingPrivateKey(
  input: KeyReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<ParkingKeyStatus> {
  const parsed = keyReplaceSchema.parse(input);
  let imported;
  try {
    imported = await privateKeyImportService.importKey({
      rawKeyMaterial: parsed.rawKeyMaterial,
      passphrase: parsed.passphrase,
    });
  } catch (error) {
    if (isKeyImportError(error)) throw error;
    throw new KeyImportError("INVALID_KEY", "Key import failed");
  }

  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(encryption.encrypt(imported.normalizedPem));
  const existing = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });

  await prisma.parkingSshSecret.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      privateKeyCiphertext: ciphertext,
      keyFingerprint: imported.fingerprintSha256,
      keyAlgo: imported.algorithm,
    },
    update: {
      privateKeyCiphertext: ciphertext,
      keyFingerprint: imported.fingerprintSha256,
      keyAlgo: imported.algorithm,
    },
  });

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.PARKING_KEY_REPLACE,
    entityType: "parking_ssh_secret",
    entityId: "1",
    ip: actor.ip,
    meta: {
      replacedExisting: Boolean(existing?.privateKeyCiphertext),
      keyAlgo: imported.algorithm,
      keyFingerprint: imported.fingerprintSha256,
      sourceFormat: imported.sourceFormat,
      passphraseProvided: Boolean(parsed.passphrase),
    },
  });

  return {
    configured: true,
    fingerprint: imported.fingerprintSha256,
    algo: imported.algorithm,
  };
}
