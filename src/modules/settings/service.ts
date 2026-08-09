/**
 * Settings + active SSH profile persistence (v1: single active profile).
 *
 * API responses are masked: never return private key ciphertext or plaintext.
 * Passphrase is import-time only and is never stored (approved security model).
 *
 * Polling flags are persisted here; the in-process scheduler reads them on each
 * tick and hot-reschedules after poll-related updates.
 */

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  isAutoSchedulerRunning,
  rescheduleAfterSettingsChange,
} from "@/modules/jobs/scheduler";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";
import {
  privateKeyImportService,
  type ImportedPrivateKey,
} from "@/modules/ssh/import-key";
import { isKeyImportError, KeyImportError } from "@/modules/ssh/errors";
import {
  DEFAULT_SSH_PROFILE_NAME,
  keyReplaceSchema,
  settingsUpdateSchema,
  type KeyReplaceInput,
  type SettingsUpdateInput,
  type SettingsUpdateResult,
  type SettingsView,
} from "@/modules/settings/schemas";

async function ensureAppSettings() {
  return prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
    include: { activeSshProfile: true },
  });
}

function toSettingsView(
  settings: Awaited<ReturnType<typeof ensureAppSettings>>,
): SettingsView {
  const profile = settings.activeSshProfile;
  return {
    host: profile?.host ?? null,
    port: profile?.port ?? null,
    username: profile?.username ?? null,
    profileId: profile?.id ?? null,
    hasPrivateKey: Boolean(profile?.privateKeyCiphertext),
    keyFingerprint: profile?.keyFingerprint ?? null,
    keyAlgo: profile?.keyAlgo ?? null,
    regsPollEnabled: settings.regsPollEnabled,
    regsPollIntervalSec: settings.regsPollIntervalSec,
    artifactRetentionDays: settings.artifactRetentionDays,
    artifactKeepLastRuns: settings.artifactKeepLastRuns,
    artifactMaxBytes: settings.artifactMaxBytes,
    schedulerLoopActive: isAutoSchedulerRunning(),
  };
}

/**
 * Masked settings view for UI/API. Never includes ciphertext or plaintext keys.
 */
export async function getSettingsView(): Promise<SettingsView> {
  const settings = await ensureAppSettings();
  return toSettingsView(settings);
}

/**
 * Ensure a single active SSH profile exists (v1). Creates default profile if needed.
 */
async function ensureActiveProfile(
  settings: Awaited<ReturnType<typeof ensureAppSettings>>,
) {
  if (settings.activeSshProfile) {
    return { profile: settings.activeSshProfile, created: false, settings };
  }

  const profile = await prisma.sshProfile.create({
    data: {
      name: DEFAULT_SSH_PROFILE_NAME,
      host: "localhost",
      port: 22,
      username: "platform",
    },
  });

  const updated = await prisma.appSetting.update({
    where: { id: 1 },
    data: { activeSshProfileId: profile.id },
    include: { activeSshProfile: true },
  });

  return { profile, created: true, settings: updated };
}

export async function updateSettings(
  input: SettingsUpdateInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsUpdateResult> {
  const parsed = settingsUpdateSchema.parse(input);
  let settings = await ensureAppSettings();

  const sshFieldsProvided =
    parsed.host !== undefined ||
    parsed.port !== undefined ||
    parsed.username !== undefined;

  const pollScheduleChanged =
    parsed.regsPollEnabled !== undefined ||
    parsed.regsPollIntervalSec !== undefined;

  let createdProfile = false;

  if (sshFieldsProvided) {
    const ensured = await ensureActiveProfile(settings);
    createdProfile = ensured.created;
    settings = ensured.settings;

    const profileId = ensured.profile.id;
    await prisma.sshProfile.update({
      where: { id: profileId },
      data: {
        ...(parsed.host !== undefined ? { host: parsed.host } : {}),
        ...(parsed.port !== undefined ? { port: parsed.port } : {}),
        ...(parsed.username !== undefined ? { username: parsed.username } : {}),
      },
    });
  }

  const settingsData: {
    regsPollEnabled?: boolean;
    regsPollIntervalSec?: number;
    artifactRetentionDays?: number;
    artifactKeepLastRuns?: number;
    artifactMaxBytes?: number;
  } = {};

  if (parsed.regsPollEnabled !== undefined) {
    settingsData.regsPollEnabled = parsed.regsPollEnabled;
  }
  if (parsed.regsPollIntervalSec !== undefined) {
    settingsData.regsPollIntervalSec = parsed.regsPollIntervalSec;
  }
  if (parsed.artifactRetentionDays !== undefined) {
    settingsData.artifactRetentionDays = parsed.artifactRetentionDays;
  }
  if (parsed.artifactKeepLastRuns !== undefined) {
    settingsData.artifactKeepLastRuns = parsed.artifactKeepLastRuns;
  }
  if (parsed.artifactMaxBytes !== undefined) {
    settingsData.artifactMaxBytes = parsed.artifactMaxBytes;
  }

  if (Object.keys(settingsData).length > 0 || sshFieldsProvided) {
    await prisma.appSetting.update({
      where: { id: 1 },
      data: settingsData,
    });
  }

  settings = await prisma.appSetting.findUniqueOrThrow({
    where: { id: 1 },
    include: { activeSshProfile: true },
  });

  if (pollScheduleChanged) {
    await rescheduleAfterSettingsChange();
  }

  const view = toSettingsView(settings);

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.SETTINGS_UPDATE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      createdProfile,
      host: view.host,
      port: view.port,
      username: view.username,
      regsPollEnabled: view.regsPollEnabled,
      regsPollIntervalSec: view.regsPollIntervalSec,
      artifactRetentionDays: view.artifactRetentionDays,
      artifactKeepLastRuns: view.artifactKeepLastRuns,
      artifactMaxBytes: view.artifactMaxBytes,
      schedulerLoopActive: view.schedulerLoopActive,
    },
  });

  return { settings: view, createdProfile };
}

function encryptImportedKey(imported: ImportedPrivateKey): string {
  const encryption = getSecretEncryptionService();
  try {
    return serializeEncryptedSecret(encryption.encrypt(imported.normalizedPem));
  } catch {
    throw new KeyImportError(
      "ENCRYPT_FAILED",
      "Failed to encrypt private key for storage",
    );
  }
}

/**
 * Replace SSH private key on the active profile.
 * Passphrase is used only to unwrap PPK/PEM during import — never stored.
 */
export async function replaceSshPrivateKey(
  input: KeyReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = keyReplaceSchema.parse(input);

  let imported: ImportedPrivateKey;
  try {
    imported = await privateKeyImportService.importKey({
      rawKeyMaterial: parsed.rawKeyMaterial,
      passphrase: parsed.passphrase,
    });
  } catch (error) {
    if (isKeyImportError(error)) throw error;
    throw new KeyImportError("INVALID_KEY", "Key import failed");
  }

  const ciphertext = encryptImportedKey(imported);

  let settings = await ensureAppSettings();
  const ensured = await ensureActiveProfile(settings);
  const hadKey = Boolean(ensured.profile.privateKeyCiphertext);

  await prisma.sshProfile.update({
    where: { id: ensured.profile.id },
    data: {
      privateKeyCiphertext: ciphertext,
      keyFingerprint: imported.fingerprintSha256,
      keyAlgo: imported.algorithm,
    },
  });

  settings = await prisma.appSetting.findUniqueOrThrow({
    where: { id: 1 },
    include: { activeSshProfile: true },
  });

  const view = toSettingsView(settings);

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.SSH_KEY_REPLACE,
    entityType: "ssh_profile",
    entityId: ensured.profile.id,
    ip: actor.ip,
    meta: {
      replacedExisting: hadKey,
      keyAlgo: imported.algorithm,
      keyFingerprint: imported.fingerprintSha256,
      sourceFormat: imported.sourceFormat,
      // passphrase never stored; presence during import is not logged as secret
      passphraseProvided: Boolean(parsed.passphrase),
    },
  });

  return view;
}

/**
 * Load decrypted private key for in-process SSH use only.
 * Caller must not log or return the plaintext.
 */
export async function loadActiveSshPrivateKeyPem(): Promise<{
  profileId: string;
  host: string;
  port: number;
  username: string;
  privateKeyPem: string;
} | null> {
  const settings = await ensureAppSettings();
  const profile = settings.activeSshProfile;
  if (!profile?.privateKeyCiphertext) return null;

  const encryption = getSecretEncryptionService();
  const envelope = deserializeEncryptedSecret(profile.privateKeyCiphertext);
  const privateKeyPem = encryption.decrypt(envelope);

  return {
    profileId: profile.id,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    privateKeyPem,
  };
}
