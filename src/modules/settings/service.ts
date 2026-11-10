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
  PHONES_SYNC_INTERVAL_SEC,
  REGS_POLL_INTERVAL_SEC,
} from "@/modules/jobs/export-cadence";
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
  didKeyReplaceSchema,
  pstnKeyReplaceSchema,
  settingsUpdateSchema,
  voipmonitorPasswordReplaceSchema,
  rtuSoapPasswordReplaceSchema,
  zabbixPasswordReplaceSchema,
  type FtpPasswordReplaceInput,
  type VoipmonitorPasswordReplaceInput,
  type RtuSoapPasswordReplaceInput,
  type ZabbixPasswordReplaceInput,
  type GeoipKeyReplaceInput,
  type KeyReplaceInput,
  type DidKeyReplaceInput,
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
import {
  DEFAULT_DID_BASE_URL,
  resolveDidBaseUrl,
} from "@/modules/did/types";
import { describeRtuCa, rtuCaPemForStore } from "@/modules/rtu-soap/ca";
import { parseRtuSoapOrigin } from "@/modules/rtu-soap/origin";
import { clearZabbixDashboardCache } from "@/modules/zabbix/cache";
import { parseZabbixApiUrl } from "@/modules/zabbix/url";

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
    regsPollIntervalSec: REGS_POLL_INTERVAL_SEC,
    exportSyncEnabled: settings.exportSyncEnabled,
    exportSyncIntervalSec: PHONES_SYNC_INTERVAL_SEC,
    cdrSidesRefreshEnabled: settings.cdrSidesRefreshEnabled,
    cdrSidesRefreshIntervalSec: settings.cdrSidesRefreshIntervalSec,
    numberGeographyRefreshEnabled: settings.numberGeographyRefreshEnabled,
    numberGeographyRefreshIntervalSec: settings.numberGeographyRefreshIntervalSec,
    artifactRetentionDays: settings.artifactRetentionDays,
    artifactKeepLastRuns: settings.artifactKeepLastRuns,
    artifactMaxBytes: settings.artifactMaxBytes,
    schedulerLoopActive: isAutoSchedulerRunning(),
    geoipBaseUrl: resolveGeoipBaseUrl(settings.geoipBaseUrl),
    hasGeoipApiKey: Boolean(settings.geoipApiKeyCiphertext),
    pstnBaseUrl: resolvePstnBaseUrl(settings.pstnBaseUrl),
    hasPstnApiKey: Boolean(settings.pstnApiKeyCiphertext),
    didBaseUrl: resolveDidBaseUrl(settings.didBaseUrl),
    hasDidApiToken: Boolean(settings.didApiTokenCiphertext),
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
    rtuSoapBaseUrl: settings.rtuSoapBaseUrl ?? null,
    rtuSoapLogin: settings.rtuSoapLogin ?? null,
    hasRtuSoapPassword: Boolean(settings.rtuSoapPasswordCiphertext),
    ...describeRtuCa(settings.rtuSoapCaPem),
    zabbixApiUrl: settings.zabbixApiUrl ?? null,
    zabbixUser: settings.zabbixUser ?? null,
    hasZabbixPassword: Boolean(settings.zabbixPasswordCiphertext),
    zabbixGraph1Host: settings.zabbixGraph1Host ?? null,
    zabbixGraph1Name: settings.zabbixGraph1Name ?? null,
    zabbixGraph2Host: settings.zabbixGraph2Host ?? null,
    zabbixGraph2Name: settings.zabbixGraph2Name ?? null,
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
    parsed.exportSyncEnabled !== undefined ||
    parsed.cdrSidesRefreshEnabled !== undefined ||
    parsed.cdrSidesRefreshIntervalSec !== undefined;
  // numberGeographyRefresh* only reloads an open table. It does not
  // reschedule regs, export, or side refresh.

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
    exportSyncEnabled?: boolean;
    cdrSidesRefreshEnabled?: boolean;
    cdrSidesRefreshIntervalSec?: number;
    numberGeographyRefreshEnabled?: boolean;
    numberGeographyRefreshIntervalSec?: number;
    artifactRetentionDays?: number;
    artifactKeepLastRuns?: number;
    artifactMaxBytes?: number;
    geoipBaseUrl?: string | null;
    pstnBaseUrl?: string | null;
    didBaseUrl?: string | null;
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
    rtuSoapBaseUrl?: string | null;
    rtuSoapLogin?: string | null;
    rtuSoapCaPem?: string | null;
    zabbixApiUrl?: string | null;
    zabbixUser?: string | null;
    zabbixGraph1Host?: string | null;
    zabbixGraph1Name?: string | null;
    zabbixGraph2Host?: string | null;
    zabbixGraph2Name?: string | null;
  } = {};

  if (parsed.regsPollEnabled !== undefined) {
    settingsData.regsPollEnabled = parsed.regsPollEnabled;
  }
  if (parsed.exportSyncEnabled !== undefined) {
    settingsData.exportSyncEnabled = parsed.exportSyncEnabled;
  }
  if (parsed.cdrSidesRefreshEnabled !== undefined) {
    settingsData.cdrSidesRefreshEnabled = parsed.cdrSidesRefreshEnabled;
  }
  if (parsed.cdrSidesRefreshIntervalSec !== undefined) {
    settingsData.cdrSidesRefreshIntervalSec = parsed.cdrSidesRefreshIntervalSec;
  }
  if (parsed.numberGeographyRefreshEnabled !== undefined) {
    settingsData.numberGeographyRefreshEnabled =
      parsed.numberGeographyRefreshEnabled;
  }
  if (parsed.numberGeographyRefreshIntervalSec !== undefined) {
    settingsData.numberGeographyRefreshIntervalSec =
      parsed.numberGeographyRefreshIntervalSec;
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
  if (parsed.didBaseUrl !== undefined) {
    const trimmed = parsed.didBaseUrl.trim();
    settingsData.didBaseUrl = trimmed
      ? resolveDidBaseUrl(trimmed)
      : DEFAULT_DID_BASE_URL;
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
  if (parsed.rtuSoapBaseUrl !== undefined) {
    const trimmed = parsed.rtuSoapBaseUrl.trim();
    settingsData.rtuSoapBaseUrl = trimmed ? parseRtuSoapOrigin(trimmed) : null;
  }
  if (parsed.rtuSoapLogin !== undefined) {
    const trimmed = parsed.rtuSoapLogin.trim();
    settingsData.rtuSoapLogin = trimmed || null;
  }
  if (parsed.rtuSoapCaPem !== undefined) {
    settingsData.rtuSoapCaPem = rtuCaPemForStore(parsed.rtuSoapCaPem);
  }
  if (parsed.zabbixApiUrl !== undefined) {
    const trimmed = parsed.zabbixApiUrl.trim();
    settingsData.zabbixApiUrl = trimmed ? parseZabbixApiUrl(trimmed) : null;
  }
  if (parsed.zabbixUser !== undefined) {
    settingsData.zabbixUser = parsed.zabbixUser.trim() || null;
  }
  if (parsed.zabbixGraph1Host !== undefined) {
    settingsData.zabbixGraph1Host = parsed.zabbixGraph1Host.trim() || null;
  }
  if (parsed.zabbixGraph1Name !== undefined) {
    settingsData.zabbixGraph1Name = parsed.zabbixGraph1Name.trim() || null;
  }
  if (parsed.zabbixGraph2Host !== undefined) {
    settingsData.zabbixGraph2Host = parsed.zabbixGraph2Host.trim() || null;
  }
  if (parsed.zabbixGraph2Name !== undefined) {
    settingsData.zabbixGraph2Name = parsed.zabbixGraph2Name.trim() || null;
  }

  const zabbixChanged =
    parsed.zabbixApiUrl !== undefined ||
    parsed.zabbixUser !== undefined ||
    parsed.zabbixGraph1Host !== undefined ||
    parsed.zabbixGraph1Name !== undefined ||
    parsed.zabbixGraph2Host !== undefined ||
    parsed.zabbixGraph2Name !== undefined;

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
  if (zabbixChanged) clearZabbixDashboardCache();

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
      cdrSidesRefreshEnabled: view.cdrSidesRefreshEnabled,
      cdrSidesRefreshIntervalSec: view.cdrSidesRefreshIntervalSec,
      numberGeographyRefreshEnabled: view.numberGeographyRefreshEnabled,
      numberGeographyRefreshIntervalSec: view.numberGeographyRefreshIntervalSec,
      artifactRetentionDays: view.artifactRetentionDays,
      artifactKeepLastRuns: view.artifactKeepLastRuns,
      artifactMaxBytes: view.artifactMaxBytes,
      schedulerLoopActive: view.schedulerLoopActive,
      geoipBaseUrl: view.geoipBaseUrl,
      hasGeoipApiKey: view.hasGeoipApiKey,
      pstnBaseUrl: view.pstnBaseUrl,
      hasPstnApiKey: view.hasPstnApiKey,
      didBaseUrl: view.didBaseUrl,
      hasDidApiToken: view.hasDidApiToken,
      displayTimezone: view.displayTimezone,
      ftpEnabled: view.ftpEnabled,
      ftpUsername: view.ftpUsername,
      ftpListenPort: view.ftpListenPort,
      ftpListenerActive: view.ftpListenerActive,
      voipmonitorEnabled: view.voipmonitorEnabled,
      voipmonitorApiUrl: view.voipmonitorApiUrl,
      voipmonitorGuiUrl: view.voipmonitorGuiUrl,
      rtuSoapBaseUrl: view.rtuSoapBaseUrl,
      rtuSoapLogin: view.rtuSoapLogin,
      hasRtuSoapPassword: view.hasRtuSoapPassword,
      hasRtuSoapCa: view.hasRtuSoapCa,
      zabbixApiUrl: view.zabbixApiUrl,
      zabbixUser: view.zabbixUser,
      hasZabbixPassword: view.hasZabbixPassword,
      zabbixGraph1Host: view.zabbixGraph1Host,
      zabbixGraph1Name: view.zabbixGraph1Name,
      zabbixGraph2Host: view.zabbixGraph2Host,
      zabbixGraph2Name: view.zabbixGraph2Name,
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
 * Replace DID ADMIN_API_TOKEN. Never returns plaintext.
 */
export async function replaceDidApiToken(
  input: DidKeyReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = didKeyReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.apiKey.trim()),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, didApiTokenCiphertext: ciphertext },
    update: { didApiTokenCiphertext: ciphertext },
  });

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.DID_KEY_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      replacedExisting: true,
      hasDidApiToken: true,
      didBaseUrl: view.didBaseUrl,
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

/**
 * Replace the RTU SOAP password. Never returns plaintext.
 * This writes only the local settings row. It does not call the switch.
 */
export async function replaceRtuSoapPassword(
  input: RtuSoapPasswordReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = rtuSoapPasswordReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(
    encryption.encrypt(parsed.password),
  );

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, rtuSoapPasswordCiphertext: ciphertext },
    update: { rtuSoapPasswordCiphertext: ciphertext },
  });

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.RTU_SOAP_PASSWORD_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: { hasRtuSoapPassword: true },
  });

  return view;
}

/**
 * Replace the Zabbix password. Never returns plaintext.
 * This writes only the local settings row. It does not call Zabbix.
 */
export async function replaceZabbixPassword(
  input: ZabbixPasswordReplaceInput,
  actor: { userId: string; ip?: string | null },
): Promise<SettingsView> {
  const parsed = zabbixPasswordReplaceSchema.parse(input);
  const encryption = getSecretEncryptionService();
  const ciphertext = serializeEncryptedSecret(encryption.encrypt(parsed.password));

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, zabbixPasswordCiphertext: ciphertext },
    update: { zabbixPasswordCiphertext: ciphertext },
  });
  clearZabbixDashboardCache();

  const view = await getSettingsView();

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.ZABBIX_PASSWORD_REPLACE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: { hasZabbixPassword: true },
  });

  return view;
}
