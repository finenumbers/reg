/**
 * Settings DTOs / Zod schemas (no Prisma import — safe for unit tests).
 */

import { z } from "zod";
import { isAcceptedDisplayTimezone } from "@/lib/display-timezone";
import { DEFAULT_GEOIP_BASE_URL } from "@/modules/geoip/types";
import {
  DEFAULT_PSTN_BASE_URL,
  SAME_HOST_PSTN_BASE_URL,
} from "@/modules/pstn/types";
import {
  DEFAULT_DID_BASE_URL,
  SAME_HOST_DID_BASE_URL,
} from "@/modules/did/types";
import { parseRtuCaPem, rtuCaPemMessage } from "@/modules/rtu-soap/ca";
import { parseRtuSoapOrigin } from "@/modules/rtu-soap/origin";
import { parseZabbixApiUrl } from "@/modules/zabbix/url";

function httpOriginSchema(label: string) {
  return z
    .string()
    .max(2048)
    .refine((value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return true;
      try {
        const url = new URL(trimmed);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, `${label} URL must be a valid http(s) origin`);
}

const geoipBaseUrlSchema = httpOriginSchema("GeoIP");
const pstnBaseUrlSchema = httpOriginSchema("PSTN");
const rtuSoapBaseUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    const trimmed = value.trim();
    return trimmed.length === 0 || parseRtuSoapOrigin(trimmed) !== null;
  }, "URL API РТУ должен быть https-origin без пути и учётных данных");

/** Empty string clears the saved PEM. Omitted field leaves it unchanged. */
const rtuSoapCaPemSchema = z
  .string()
  .max(32_768)
  .superRefine((value, ctx) => {
    if (value.length === 0) return;
    const parsed = parseRtuCaPem(value);
    if (parsed.ok) return;
    ctx.addIssue({ code: "custom", message: rtuCaPemMessage(parsed.reason) });
  });

const didBaseUrlSchema = httpOriginSchema("DID").refine((value) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  try {
    const url = new URL(trimmed);
    return url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}, "DID URL must not include credentials");

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** Empty clears PASV. A hostname would be split on dots in the 227 reply. */
export const ftpPasvAddressSchema = z
  .string()
  .max(255)
  .refine((value) => {
    const trimmed = value.trim();
    return trimmed.length === 0 || IPV4_RE.test(trimmed);
  }, "Внешний адрес пассивного режима должен быть IPv4");

function zabbixSlotPair(
  host: string | undefined,
  name: string | undefined,
  slot: string,
  ctx: z.RefinementCtx,
) {
  if (host === undefined && name === undefined) return;
  if (host === undefined || name === undefined) {
    ctx.addIssue({
      code: "custom",
      message: `График ${slot}: укажите хост и название`,
    });
    return;
  }
  const hostText = host.trim();
  const nameText = name.trim();
  if ((hostText.length === 0) !== (nameText.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: `График ${slot}: укажите хост и название`,
    });
  }
}

export const settingsUpdateSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(255).optional(),
  regsPollEnabled: z.boolean().optional(),
  exportSyncEnabled: z.boolean().optional(),
  cdrSidesRefreshEnabled: z.boolean().optional(),
  cdrSidesRefreshIntervalSec: z.number().int().min(30).max(86400).optional(),
  numberGeographyRefreshEnabled: z.boolean().optional(),
  numberGeographyRefreshIntervalSec: z
    .number()
    .int()
    .min(30)
    .max(86400)
    .optional(),
  artifactRetentionDays: z.number().int().min(1).max(365).optional(),
  artifactKeepLastRuns: z.number().int().min(1).max(1000).optional(),
  artifactMaxBytes: z.number().int().min(1024).max(50_000_000).optional(),
  geoipBaseUrl: geoipBaseUrlSchema.optional(),
  pstnBaseUrl: pstnBaseUrlSchema.optional(),
  didBaseUrl: didBaseUrlSchema.optional(),
  displayTimezone: z
    .string()
    .refine(isAcceptedDisplayTimezone, "Unsupported display timezone")
    .optional(),
  ftpEnabled: z.boolean().optional(),
  ftpUsername: z.string().min(1).max(128).optional(),
  ftpListenPort: z.number().int().min(1).max(65535).optional(),
  ftpPasvMinPort: z.number().int().min(1024).max(65535).optional(),
  ftpPasvMaxPort: z.number().int().min(1024).max(65535).optional(),
  ftpPasvAddress: ftpPasvAddressSchema.optional(),
  voipmonitorEnabled: z.boolean().optional(),
  voipmonitorApiUrl: httpOriginSchema("VoIPmonitor API").optional(),
  voipmonitorUser: z.string().max(255).optional(),
  voipmonitorGuiUrl: httpOriginSchema("VoIPmonitor GUI").optional(),
  rtuSoapBaseUrl: rtuSoapBaseUrlSchema.optional(),
  rtuSoapLogin: z.string().max(255).optional(),
  rtuSoapCaPem: rtuSoapCaPemSchema.optional(),
  zabbixApiUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 || parseZabbixApiUrl(trimmed) !== null;
    }, "Адрес Zabbix должен быть https без учётных данных и query")
    .optional(),
  zabbixUser: z.string().max(128).optional(),
  zabbixGraph1Host: z.string().max(128).optional(),
  zabbixGraph1Name: z.string().max(128).optional(),
  zabbixGraph1Title: z.string().max(128).optional(),
  zabbixGraph2Host: z.string().max(128).optional(),
  zabbixGraph2Name: z.string().max(128).optional(),
  zabbixGraph2Title: z.string().max(128).optional(),
}).superRefine((value, ctx) => {
  zabbixSlotPair(value.zabbixGraph1Host, value.zabbixGraph1Name, "1", ctx);
  zabbixSlotPair(value.zabbixGraph2Host, value.zabbixGraph2Name, "2", ctx);
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const keyReplaceSchema = z.object({
  rawKeyMaterial: z.string().min(1),
  passphrase: z.string().max(1024).optional(),
});

export type KeyReplaceInput = z.infer<typeof keyReplaceSchema>;

export const geoipKeyReplaceSchema = z.object({
  apiKey: z.string().min(1).max(4096),
});

export type GeoipKeyReplaceInput = z.infer<typeof geoipKeyReplaceSchema>;

export const pstnKeyReplaceSchema = z.object({
  apiKey: z.string().min(1).max(4096),
});

export type PstnKeyReplaceInput = z.infer<typeof pstnKeyReplaceSchema>;

export const didKeyReplaceSchema = z.object({
  apiKey: z.string().min(1).max(4096),
});

export type DidKeyReplaceInput = z.infer<typeof didKeyReplaceSchema>;

export const ftpPasswordReplaceSchema = z.object({
  password: z.string().min(1).max(1024),
});

export const voipmonitorPasswordReplaceSchema = z.object({
  password: z.string().min(1).max(1024),
});

export const rtuSoapPasswordReplaceSchema = z.object({
  password: z.string().min(1).max(1024),
});

export const zabbixPasswordReplaceSchema = z.object({
  password: z.string().min(1).max(1024),
});

export type RtuSoapPasswordReplaceInput = z.infer<
  typeof rtuSoapPasswordReplaceSchema
>;

export type ZabbixPasswordReplaceInput = z.infer<typeof zabbixPasswordReplaceSchema>;

export type VoipmonitorPasswordReplaceInput = z.infer<
  typeof voipmonitorPasswordReplaceSchema
>;

export type FtpPasswordReplaceInput = z.infer<typeof ftpPasswordReplaceSchema>;

export type SettingsView = {
  host: string | null;
  port: number | null;
  username: string | null;
  profileId: string | null;
  /** Never expose key material — only whether a key is stored */
  hasPrivateKey: boolean;
  keyFingerprint: string | null;
  keyAlgo: string | null;
  regsPollEnabled: boolean;
  /** Fixed registration poll. The stored column is not the schedule. */
  regsPollIntervalSec: number;
  exportSyncEnabled: boolean;
  /** Fixed phone-catalog period. Groups use their own fixed period. */
  exportSyncIntervalSec: number;
  cdrSidesRefreshEnabled: boolean;
  cdrSidesRefreshIntervalSec: number;
  numberGeographyRefreshEnabled: boolean;
  numberGeographyRefreshIntervalSec: number;
  artifactRetentionDays: number;
  artifactKeepLastRuns: number;
  artifactMaxBytes: number;
  /** True when the in-process scheduler timer loop is running */
  schedulerLoopActive: boolean;
  geoipBaseUrl: string | null;
  /** Never expose the GeoIP API key — only whether it is stored */
  hasGeoipApiKey: boolean;
  pstnBaseUrl: string | null;
  /** Never expose the PSTN API key — only whether it is stored */
  hasPstnApiKey: boolean;
  didBaseUrl: string | null;
  /** Never expose the DID token — only whether it is stored */
  hasDidApiToken: boolean;
  displayTimezone: string;
  ftpEnabled: boolean;
  ftpUsername: string | null;
  hasFtpPassword: boolean;
  ftpListenPort: number;
  ftpPasvMinPort: number;
  ftpPasvMaxPort: number;
  ftpPasvAddress: string | null;
  ftpListenerActive: boolean;
  voipmonitorEnabled: boolean;
  voipmonitorApiUrl: string | null;
  voipmonitorUser: string | null;
  hasVoipmonitorPassword: boolean;
  voipmonitorGuiUrl: string | null;
  rtuSoapBaseUrl: string | null;
  rtuSoapLogin: string | null;
  /** Never expose the RTU password — only whether it is stored */
  hasRtuSoapPassword: boolean;
  /** Public certificates. The PEM itself is not returned. */
  hasRtuSoapCa: boolean;
  rtuSoapCaCerts: { fingerprint256: string; subject: string }[];
  zabbixApiUrl: string | null;
  zabbixUser: string | null;
  /** Never expose the Zabbix password — only whether it is stored */
  hasZabbixPassword: boolean;
  zabbixGraph1Host: string | null;
  zabbixGraph1Name: string | null;
  zabbixGraph1Title: string | null;
  zabbixGraph2Host: string | null;
  zabbixGraph2Name: string | null;
  zabbixGraph2Title: string | null;
};

export type SettingsUpdateResult = {
  settings: SettingsView;
  createdProfile: boolean;
};

export const DEFAULT_SSH_PROFILE_NAME = "softswitch";
export {
  DEFAULT_GEOIP_BASE_URL,
  DEFAULT_PSTN_BASE_URL,
  SAME_HOST_PSTN_BASE_URL,
  DEFAULT_DID_BASE_URL,
  SAME_HOST_DID_BASE_URL,
};
