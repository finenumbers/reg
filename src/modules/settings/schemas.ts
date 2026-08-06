/**
 * Settings DTOs / Zod schemas (no Prisma import — safe for unit tests).
 */

import { z } from "zod";

export const settingsUpdateSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(255).optional(),
  regsPollEnabled: z.boolean().optional(),
  regsPollIntervalSec: z.number().int().min(30).max(86400).optional(),
  artifactRetentionDays: z.number().int().min(1).max(365).optional(),
  artifactKeepLastRuns: z.number().int().min(1).max(1000).optional(),
  artifactMaxBytes: z.number().int().min(1024).max(50_000_000).optional(),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const keyReplaceSchema = z.object({
  rawKeyMaterial: z.string().min(1),
  passphrase: z.string().max(1024).optional(),
});

export type KeyReplaceInput = z.infer<typeof keyReplaceSchema>;

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
};

export type SettingsUpdateResult = {
  settings: SettingsView;
  createdProfile: boolean;
};

export const DEFAULT_SSH_PROFILE_NAME = "softswitch";
