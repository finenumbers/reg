import { z } from "zod";

/**
 * Server-side environment contract.
 * Secrets must never be hardcoded or exposed to the client bundle.
 *
 * Production assumptions (v1):
 * - single `app` replica (in-process scheduler + in-memory rate limits)
 * - auto-poll enablement is Settings-only (regsPollEnabled)
 * - BETTER_AUTH_URL is the public origin (HTTPS behind NPM)
 */

const EXAMPLE_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a valid URL (public app origin)"),
  /** AES-256-GCM master key: exactly 32 bytes as 64 hex characters */
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate: openssl rand -hex 32",
    ),
  ADMIN_USERNAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_DISPLAY_NAME: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

function isWeakAuthSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  return (
    lower.includes("change-me") ||
    lower.includes("dev-only") ||
    lower.includes("example") ||
    lower === "secret".repeat(4)
  );
}

function productionGuards(env: ServerEnv): string[] {
  const issues: string[] = [];
  if (env.NODE_ENV !== "production") return issues;

  if (isWeakAuthSecret(env.BETTER_AUTH_SECRET)) {
    issues.push(
      "BETTER_AUTH_SECRET looks like a placeholder — set a strong secret (openssl rand -base64 32)",
    );
  }
  if (env.APP_ENCRYPTION_KEY.toLowerCase() === EXAMPLE_ENCRYPTION_KEY) {
    issues.push(
      "APP_ENCRYPTION_KEY is the documented example value — generate a unique key (openssl rand -hex 32). Losing this key makes stored SSH keys undecryptable.",
    );
  }
  if (env.BETTER_AUTH_URL.startsWith("http://") && !env.BETTER_AUTH_URL.includes("localhost")) {
    issues.push(
      "BETTER_AUTH_URL uses http:// in production — prefer https:// behind Nginx Proxy Manager",
    );
  }
  return issues;
}

export type EnvValidationResult =
  | { ok: true; env: ServerEnv; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validate env without throwing — used by readiness and startup logging.
 */
export function tryValidateServerEnv(): EnvValidationResult {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid server environment: ${details}` };
  }

  const warnings = productionGuards(parsed.data);
  if (parsed.data.NODE_ENV === "production" && warnings.length > 0) {
    // Hard-fail on weak secrets / example encryption key in production.
    const fatal = warnings.filter(
      (w) =>
        w.includes("BETTER_AUTH_SECRET") || w.includes("APP_ENCRYPTION_KEY"),
    );
    if (fatal.length > 0) {
      return { ok: false, error: fatal.join(" | ") };
    }
  }

  return { ok: true, env: parsed.data, warnings };
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = tryValidateServerEnv();
  if (!result.ok) {
    throw new Error(result.error);
  }
  cached = result.env;
  return cached;
}

/**
 * Validate once at process start. Throws on invalid/weak production secrets.
 * Returns warnings (e.g. http BETTER_AUTH_URL) for logging.
 */
export function assertServerEnvAtStartup(): {
  env: ServerEnv;
  warnings: string[];
} {
  const result = tryValidateServerEnv();
  if (!result.ok) {
    throw new Error(result.error);
  }
  cached = result.env;
  return { env: result.env, warnings: result.warnings };
}

/** Test helper — clear cached env between cases. */
export function resetServerEnvCacheForTests(): void {
  cached = null;
}
