import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX_LEN = 12;

/** Generate a one-time plaintext API key: `reg_<base64url>`. */
export function generateApiKeySecret(): string {
  return `reg_${randomBytes(24).toString("base64url")}`;
}

/** Platform machine keys are `reg_…`. Other Bearer values must not steal the API-key path. */
export function isPlatformApiKeySecret(secret: string): boolean {
  return secret.startsWith("reg_");
}

export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, KEY_PREFIX_LEN);
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyApiKeyHash(secret: string, keyHash: string): boolean {
  const computed = hashApiKey(secret);
  try {
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(keyHash, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extract raw key from Authorization Bearer or X-Api-Key.
 * Prefers Authorization when both are present.
 */
export function extractApiKeyFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (match?.[1] && isPlatformApiKeySecret(match[1])) return match[1];
  }
  const x = headers.get("x-api-key")?.trim();
  if (x && isPlatformApiKeySecret(x)) return x;
  return null;
}

export function hasApiKeyHeader(headers: Headers): boolean {
  return extractApiKeyFromHeaders(headers) != null;
}
