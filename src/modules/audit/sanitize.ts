/**
 * Shared audit meta redaction — used on write and again on read for defense in depth.
 */

export const SECRET_META_KEYS = new Set([
  "password",
  "passphrase",
  "privatekey",
  "private_key",
  "token",
  "secret",
  "ciphertext",
  "authorization",
  "cookie",
  "rawkeymaterial",
  "raw_key_material",
]);

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (SECRET_META_KEYS.has(normalized)) return true;
  // Catch nested-ish names: sshPrivateKey, userPassword, etc.
  return (
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("privatekey") ||
    normalized.includes("ciphertext") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret")
  );
}

export function sanitizeAuditMeta(
  meta: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSecretKey(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeAuditMeta(value as Record<string, unknown>) ?? {};
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (sanitizeAuditMeta(item as Record<string, unknown>) ?? {})
          : item,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}
