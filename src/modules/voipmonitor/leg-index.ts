/**
 * Host and audio stored for the «Нет RTP» index.
 * The host is the string `isSafeVoipmonitorHref` compares: `new URL(trimmed).host`.
 * Audio is a real boolean. A string, a missing key, and any other value stay unknown.
 */

export type StoredLegIndex = {
  outHost: string;
  inHost: string;
  outAudio: boolean | null;
  inAudio: boolean | null;
};

export function screenLegHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.host;
  } catch {
    return "";
  }
}

export function screenLegAudio(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

export function indexVoipmonitorLegs(legs: unknown): StoredLegIndex {
  const raw =
    legs && typeof legs === "object" && !Array.isArray(legs)
      ? (legs as Record<string, unknown>)
      : {};
  const out = legFields(raw.out);
  const inn = legFields(raw.in);
  return {
    outHost: screenLegHost(out.url),
    inHost: screenLegHost(inn.url),
    outAudio: screenLegAudio(out.audio),
    inAudio: screenLegAudio(inn.audio),
  };
}

function legFields(value: unknown): { url: string; audio: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { url: "", audio: undefined };
  }
  const raw = value as Record<string, unknown>;
  return {
    url: typeof raw.url === "string" ? raw.url : "",
    audio: raw.audio,
  };
}
