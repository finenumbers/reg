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
import {
  DEFAULT_PARKING_TARGET,
  parseParkingHost,
  parseParkingLogPath,
  parseParkingUser,
  ParkingTargetError,
  type ParkingTarget,
} from "@/modules/antifraud/target";
import { keyReplaceSchema, type KeyReplaceInput } from "@/modules/settings/schemas";

export type { ParkingKeyStatus };

function statusFrom(
  row: {
    privateKeyCiphertext: string | null;
    keyFingerprint: string | null;
    keyAlgo: string | null;
    host: string;
    username: string;
    logPath: string;
  } | null,
): ParkingKeyStatus {
  return {
    configured: Boolean(row?.privateKeyCiphertext),
    fingerprint: row?.keyFingerprint ?? null,
    algo: row?.keyAlgo ?? null,
    host: row?.host ?? DEFAULT_PARKING_TARGET.host,
    username: row?.username ?? DEFAULT_PARKING_TARGET.username,
    logPath: row?.logPath ?? DEFAULT_PARKING_TARGET.logPath,
  };
}

export async function getParkingKeyStatus(): Promise<ParkingKeyStatus> {
  const row = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  return statusFrom(row);
}

export async function loadParkingTarget(): Promise<ParkingTarget> {
  const row = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  return {
    host: parseParkingHost(row?.host ?? "") ?? DEFAULT_PARKING_TARGET.host,
    username: parseParkingUser(row?.username ?? "") ?? DEFAULT_PARKING_TARGET.username,
    logPath: parseParkingLogPath(row?.logPath ?? "") ?? DEFAULT_PARKING_TARGET.logPath,
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

  const saved = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  return statusFrom(saved);
}

export async function updateParkingTarget(
  input: { host: string; username: string; logPath: string },
  actor: { userId: string; ip?: string | null },
): Promise<ParkingKeyStatus> {
  const host = parseParkingHost(input.host);
  const username = parseParkingUser(input.username);
  const logPath = parseParkingLogPath(input.logPath);
  if (!host || !username || !logPath) {
    throw new ParkingTargetError("Некорректный адрес, имя или путь");
  }

  const existing = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  await prisma.parkingSshSecret.upsert({
    where: { id: 1 },
    create: { id: 1, host, username, logPath },
    update: { host, username, logPath },
  });
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.PARKING_TARGET_UPDATE,
    entityType: "parking_ssh_secret",
    entityId: "1",
    ip: actor.ip,
    meta: {
      host,
      username,
      logPath,
      previousHost: existing?.host ?? null,
      previousUsername: existing?.username ?? null,
      previousLogPath: existing?.logPath ?? null,
    },
  });
  const saved = await prisma.parkingSshSecret.findUnique({ where: { id: 1 } });
  return statusFrom(saved);
}
