/** Call identity. Empty tags and all-zero session ids are not keys. */

const ZERO_SESSION = /^[0-9a-f]{8}0{24}$/;

/** Remove every whitespace character and lowercase. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** Placeholder session id printed before the gateway learns the real tag. */
export function isZeroSession(normalized: string): boolean {
  return ZERO_SESSION.test(normalized);
}

/**
 * A tag that may name a call. Empty, non-hex, and the all-zero session id are not names.
 */
export function realTag(raw: string): string | null {
  const norm = normalizeTag(raw);
  if (!norm || isZeroSession(norm)) return null;
  if (!/^[0-9a-f]{16,}$/.test(norm)) return null;
  return norm;
}

/**
 * Keys to search for a CDR row. The answer-leg session id is not passed here.
 * A zero session id is not searched.
 */
export function traceSearchKeys(uniqueTag: string, radiusSessionId: string): string[] {
  const keys = new Set<string>();
  for (const raw of [uniqueTag, radiusSessionId]) {
    const tag = realTag(raw);
    if (tag) keys.add(tag);
  }
  return [...keys];
}

/**
 * The shared secret is the suffix of `Server[n]: ip:port:SECRET`.
 * Keep the address and drop the secret before any line is stored.
 */
export function redactSecrets(line: string): string {
  return line.replace(
    /(Server\[\d+\]:\s*\d{1,3}(?:\.\d{1,3}){3}:\d+):\S+/g,
    "$1",
  );
}
