/**
 * Host and audio for the «Нет RTP» index.
 * Keep this identical to src/modules/voipmonitor/leg-index.ts.
 * The host is `new URL(trimmed).host`. Audio is a real boolean.
 */

export function screenLegHost(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.host;
  } catch {
    return "";
  }
}

export function screenLegAudio(value) {
  if (value === true || value === false) return value;
  return null;
}

export function indexVoipmonitorLegs(legs) {
  const raw = legs && typeof legs === "object" && !Array.isArray(legs) ? legs : {};
  const out = legFields(raw.out);
  const inn = legFields(raw.in);
  return {
    outHost: screenLegHost(out.url),
    inHost: screenLegHost(inn.url),
    outAudio: screenLegAudio(out.audio),
    inAudio: screenLegAudio(inn.audio),
  };
}

function legFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { url: "", audio: undefined };
  }
  return {
    url: typeof value.url === "string" ? value.url : "",
    audio: value.audio,
  };
}
