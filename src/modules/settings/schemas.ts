/**
 * Settings DTOs / Zod schemas (no Prisma import — safe for unit tests).
 */

import { z } from "zod";
import { isDisplayTimezoneId } from "@/lib/display-timezone";
import { DEFAULT_GEOIP_BASE_URL } from "@/modules/geoip/types";

const geoipBaseUrlSchema = z
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
  }, "GeoIP URL must be a valid http(s) origin");

export const settingsUpdateSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(255).optional(),
  regsPollEnabled: z.boolean().optional(),
  regsPollIntervalSec: z.number().int().min(30).max(86400).optional(),
  artifactRetentionDays: z.number().int().min(1).max(365).optional(),
  artifactKeepLastRuns: z.number().int().min(1).max(1000).optional(),
  artifactMaxBytes: z.number().int().min(1024).max(50_000_000).optional(),
  geoipBaseUrl: geoipBaseUrlSchema.optional(),
  displayTimezone: z
    .string()
    .refine(isDisplayTimezoneId, "Unsupported display timezone")
    .optional(),
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
  regsPollIntervalSec: number;
  artifactRetentionDays: number;
  artifactKeepLastRuns: number;
  artifactMaxBytes: number;
  /** True when the in-process scheduler timer loop is running */
  schedulerLoopActive: boolean;
  geoipBaseUrl: string | null;
  /** Never expose the GeoIP API key — only whether it is stored */
  hasGeoipApiKey: boolean;
  displayTimezone: string;
};

export type SettingsUpdateResult = {
  settings: SettingsView;
  createdProfile: boolean;
};

export const DEFAULT_SSH_PROFILE_NAME = "softswitch";
export { DEFAULT_GEOIP_BASE_URL };
