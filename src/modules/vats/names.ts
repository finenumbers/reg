/** Path and field checks for Boss API names. Reject traversal and header breaks. */

const CONTROL = /[\u0000-\u001F\u007F]/;

export function parseDomainName(raw: string): string | null {
  if (raw.length < 1 || raw.length > 253) return null;
  if (raw.includes("..") || raw.startsWith(".") || raw.endsWith(".")) return null;
  if (/[\u0000-\u0020\u007F\\/?#@%]/.test(raw)) return null;
  if (raw.includes("/") || raw.includes("\\")) return null;
  return raw;
}

export function parseTelnum(raw: string): string | null {
  if (!/^\d{1,20}$/.test(raw)) return null;
  return raw;
}

export function parseVatsLogin(raw: string): string | null {
  const login = raw.trim();
  if (login.length < 1 || login.length > 200) return null;
  if (CONTROL.test(login)) return null;
  return login;
}

/** Password is not trimmed. CR, LF, and NUL would break the Authorization header. */
export function parseVatsPassword(raw: string): string | null {
  if (raw.length < 1 || raw.length > 500) return null;
  if (/[\r\n\u0000]/.test(raw)) return null;
  return raw;
}

/** Empty is an explicit clear. Surrounding spaces are not part of the stored value. */
export function parseClientValue(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 500) return null;
  if (CONTROL.test(value)) return null;
  return value;
}

export function parseLanguageValue(raw: string): "ru-RU" | "en-US" | null {
  if (raw === "ru-RU" || raw === "en-US") return raw;
  return null;
}

/** A blank password must not wipe a stored ciphertext. */
export function passwordWrite(
  password: string | undefined,
  hasExisting: boolean,
): "missing" | "keep" | "replace" {
  if (password != null && password.length > 0) return "replace";
  return hasExisting ? "keep" : "missing";
}

export function safeLabel(raw: string): string | null {
  const label = raw.trim();
  if (!label || label.length > 200) return null;
  if (CONTROL.test(label)) return null;
  return label;
}
