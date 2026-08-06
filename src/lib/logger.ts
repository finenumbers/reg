type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function isRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (
    normalized === "password" ||
    normalized === "passphrase" ||
    normalized === "privatekey" ||
    normalized === "private_key" ||
    normalized === "token" ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "secret" ||
    normalized === "ciphertext" ||
    normalized === "rawkeymaterial" ||
    normalized === "raw_key_material"
  ) {
    return true;
  }
  return (
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("privatekey") ||
    normalized.includes("ciphertext") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret")
  );
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isRedactKey(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ? { fields: redact(fields) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

/** Exported for focused redaction tests. */
export function redactLogFields(fields: LogFields): unknown {
  return redact(fields);
}
