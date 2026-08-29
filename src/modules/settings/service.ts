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
import { isFtpListenerActive, restartFtpServer } from "@/modules/traffic/ftp-server";
import {
  DEFAULT_SSH_PROFILE_NAME,
  ftpPasswordReplaceSchema,
  geoipKeyReplaceSchema,
  keyReplaceSchema,
  pstnKeyReplaceSchema,
  settingsUpdateSchema,
  voipmonitorPasswordReplaceSchema,
  type FtpPasswordReplaceInput,
  type VoipmonitorPasswordReplaceInput,
  type GeoipKeyReplaceInput,
  type KeyReplaceInput,
  type PstnKeyReplaceInput,
  type SettingsUpdateInput,
  type SettingsUpdateResult,
  type SettingsView,
} from "@/modules/settings/schemas";
import { resolveDisplayTimezone } from "@/lib/display-timezone";
import {
  DEFAULT_GEOIP_BASE_URL,
  resolveGeoipBaseUrl,
} from "@/modules/geoip/types";
import {
  DEFAULT_PSTN_BASE_URL,
  resolvePstnBaseUrl,
} from "@/modules/pstn/types";

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
    exportSyncEnabled: settings.exportSyncEnabled,
    exportSyncIntervalSec: settings.exportSyncIntervalSec,
    artifactRetentionDays: settings.artifactRetentionDays,
    artifactKeepLastRuns: settings.artifactKeepLastRuns,
    artifactMaxBytes: settings.artifactMaxBytes,
    schedulerLoopActive: isAutoSchedulerRunning(),
    geoipBaseUrl: resolveGeoipBaseUrl(settings.geoipBaseUrl),
    hasGeoipApiKey: Boolean(settings.geoipApiKeyCiphertext),
    pstnBaseUrl: resolvePstnBaseUrl(settings.pstnBaseUrl),
    hasPstnApiKey: Boolean(settings.pstnApiKeyCiphertext),
    displayTimezone: resolveDisplayTimezone(settings.displayTimezone),
    ftpEnabled: settings.ftpEnabled,
    ftpUsername: settings.ftpUsername ?? null,
    hasFtpPassword: Boolean(settings.ftpPasswordCiphertext),
    ftpListenPort: settings.ftpListenPort,
    ftpPasvMinPort: settings.ftpPasvMinPort,
    ftpPasvMaxPort: settings.ftpPasvMaxPort,
    ftpPasvAddress: settings.ftpPasvAddress ?? null,
    ftpListenerActive: isFtpListenerActive(),
    voipmonitorEnabled: settings.voipmonitorEnabled,
    voipmonitorApiUrl: settings.voipmonitorApiUrl ?? null,
    voipmonitorUser: settings.voipmonitorUser ?? null,
    hasVoipmonitorPassword: Boolean(settings.voipmonitorPasswordCiphertext),
    voipmonitorGuiUrl: settings.voipmonitorGuiUrl ?? null,
  };
}

/**
 * Masked settings view for UI/API. Never includes ciphertext or plaintext keys.
 */
export async function getSettingsView(): Promise<SettingsView> {
  const settings = await ensureAppSettings();
  return toSettingsView(settings);
}

/** Display IANA zone for any authenticated UI (no settings:write required). */
export async function getDisplayTimezone(): Promise<string> {
  const settings = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { displayTimezone: true },
  });
  return resolveDisplayTimezone(settings?.displayTimezone);
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
    parsed.regsPollIntervalSec !== undefined ||
    parsed.exportSyncEnabled !== undefined ||
    parsed.exportSyncIntervalSec !== undefined;

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
    exportSyncEnabled?: boolean;
    exportSyncIntervalSec?: number;
    artifactRetentionDays?: number;
    artifactKeepLastRuns?: number;
    artifactMaxBytes?: number;
    geoipBaseUrl?: string | null;
    pstnBaseUrl?: string | null;
    displayTimezone?: string;
    ftpEnabled?: boolean;
    ftpUsername?: string | null;
    ftpListenPort?: number;
    ftpPasvMinPort?: number;
    ftpPasvMaxPort?: number;
    ftpPasvAddress?: string | null;
    voipmonitorEnabled?: boolean;
    voipmonitorApiUrl?: string | null;
    voipmonitorUser?: string | null;
    voipmonitorGuiUrl?: string | null;
  } = {};

  if (parsed.regsPollEnabled !== undefined) {
    settingsData.regsPollEnabled = parsed.regsPollEnabled;
  }
  if (parsed.regsPollIntervalSec !== undefined) {
    settingsData.regsPollIntervalSec = parsed.regsPollIntervalSec;
  }
  if (parsed.exportSyncEnabled !== undefined) {
    settingsData.exportSyncEnabled = parsed.exportSyncEnabled;
  }
  if (parsed.exportSyncIntervalSec !== undefined) {
    settingsData.exportSyncIntervalSec = parsed.exportSyncIntervalSec;
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
  if (parsed.geoipBaseUrl !== undefined) {
    const trimmed = parsed.geoipBaseUrl.trim();
    settingsData.geoipBaseUrl = trimmed
      ? resolveGeoipBaseUrl(trimmed)
      : DEFAULT_GEOIP_BASE_URL;
  }
  if (parsed.pstnBaseUrl !== undefined) {
    const trimmed = parsed.pstnBaseUrl.trim();
    settingsData.pstnBaseUrl = trimmed
      ? resolvePstnBaseUrl(trimmed)
      : DEFAULT_PSTN_BASE_URL;
  }
  if (parsed.displayTimezone !== undefined) {
    settingsData.displayTimezone = resolveDisplayTimezone(
      parsed.displayTimezone,
    );
  }
  if (parsed.ftpEnabled !== undefined) {
    settingsData.ftpEnabled = parsed.ftpEnabled;
  }
  if (parsed.ftpUsername !== undefined) {
    settingsData.ftpUsername = parsed.ftpUsername.trim();
  }
  if (parsed.ftpListenPort !== undefined) {
    settingsData.ftpListenPort = parsed.ftpListenPort;
  }
  if (parsed.ftpPasvMinPort !== undefined) {
    settingsData.ftpPasvMinPort = parsed.ftpPasvMinPort;
  }
  if (parsed.ftpPasvMaxPort !== undefined) {
    settingsData.ftpPasvMaxPort = parsed.ftpPasvMaxPort;
  }
  if (parsed.ftpPasvAddress !== undefined) {
    const trimmed = parsed.ftpPasvAddress.trim();
    settingsData.ftpPasvAddress = trimmed.length > 0 ? trimmed : null;
  }
  if (parsed.voipmonitorEnabled !== undefined) {
    settingsData.voipmonitorEnabled = parsed.voipmonitorEnabled;
  }
  if (parsed.voipmonitorApiUrl !== undefined) {
    const trimmed = parsed.voipmonitorApiUrl.trim();
    settingsData.voipmonitorApiUrl = trimmed || null;
  }
  if (parsed.voipmonitorUser !== undefined) {
    settingsData.voipmonitorUser = parsed.voipmonitorUser.trim() || null;
  }
  if (parsed.voipmonitorGuiUrl !== undefined) {
    const trimmed = parsed.voipmonitorGuiUrl.trim();
    settingsData.voipmonitorGuiUrl = trimmed || null;
  }

  const ftpChanged =
    parsed.ftpEnabled !== undefined ||
    parsed.ftpUsername !== undefined ||
    parsed.ftpListenPort !== undefined ||
    parsed.ftpPasvMinPort !== undefined ||
    parsed.ftpPasvMaxPort !== undefined ||
    parsed.ftpPasvAddress !== undefined;

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
  if (ftpChanged) {
    await restartFtpServer();
    settings = await prisma.appSetting.findUniqueOrThrow({
      where: { id: 1 },
      include: { activeSshProfile: true },
    });
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
      exportSyncEnabled: view.exportSyncEnabled,
      exportSyncIntervalSec: view.exportSyncIntervalSec,
      artifactRetentionDays: view.artifactRetentionDays,
      artifactKeepLastRuns: view.artifactKeepLastRuns,
      artifactMaxBytes: view.artifactMaxBytes,
      schedulerLoopActive: view.schedulerLoopActive,
      geoipBaseUrl: view.geoipBaseUrl,
      hasGeoipApiKey: view.hasGeoipApiKey,
      pstnBaseUrl: view.pstnBaseUrl,
      hasPstnApiKey: view.hasPstnApiKey,
      displayTimezone: view.displayTimezone,
      ftpEnabled: view.ftpEnabled,
      ftpUsername: view.ftpUsername,
      ftpListenPort: view.ftpListenPort,
      ftpListenerActive: view.ftpListenerActive,
      voipmonitorEnabled: view.voipmonitorEnabled,
      voipmonitorApiUrl: view.voipmonitorApiUrl,
      voipmonitorGuiUrl: view.voipmonitorGuiUrl,
    },
  });

  if (view.voipmonitorEnabled) {
    const { requestVoipmonitorMatch } = await import(
      "@/modules/voipmonitor/enqueue"
    );
    requestVoipmonitorMatch("schedule");
  }

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

/**
 * Replace GeoIP External IP Lookup API key. Never returns plaintext.
 */
export async function replaceGeoipApiKey(
  input: GeoipKeyReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = geoipKeyReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.apiKey.trim()),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, geoipApiKeyCiphertext: ciphertext },
    update: { geoipApiKeyCiphertext: ciphertext },
  });

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.GEOIP_KEY_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      replacedExisting: true,
      hasGeoipApiKey: true,
      geoipBaseUrl: view.geoipBaseUrl,
    },
  });

  return view;
}

/**
 * Replace PSTN External Lookup API key. Never returns plaintext.
 */
export async function replacePstnApiKey(
  input: PstnKeyReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = pstnKeyReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.apiKey.trim()),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, pstnApiKeyCiphertext: ciphertext },
    update: { pstnApiKeyCiphertext: ciphertext },
  });

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.PSTN_KEY_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      replacedExisting: true,
      hasPstnApiKey: true,
      pstnBaseUrl: view.pstnBaseUrl,
    },
  });

  return view;
}

/**
 * Replace FTP inbox password. Never returns plaintext.
 */
export async function replaceFtpPassword(
  input: FtpPasswordReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = ftpPasswordReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.password),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ftpPasswordCiphertext: ciphertext },
    update: { ftpPasswordCiphertext: ciphertext },
  });

  await restartFtpServer();
  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.FTP_PASSWORD_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: { hasFtpPassword: true, ftpEnabled: view.ftpEnabled },
  });

  return view;
}

/**
 * Replace VoIPmonitor API password. Never returns plaintext.
 */
export async function replaceVoipmonitorPassword(
  input: VoipmonitorPasswordReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = voipmonitorPasswordReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.password),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, voipmonitorPasswordCiphertext: ciphertext },
    update: { voipmonitorPasswordCiphertext: ciphertext },
  });

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.VOIPMONITOR_KEY_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      hasVoipmonitorPassword: true,
      voipmonitorEnabled: view.voipmonitorEnabled,
    },
  });

  return view;
}
