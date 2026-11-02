/** HTTPS origin for the RTU web UI. No path, query, or userinfo. */

export function parseRtuSoapOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  if (!url.hostname) return null;
  return url.origin;
}

/** SOAP address must stay on the configured origin. A foreign host is refused. */
export function pinSoapEndpoint(origin: string, location: string): string | null {
  const base = parseRtuSoapOrigin(origin);
  if (!base) return null;
  let loc: URL;
  try {
    loc = new URL(location, base);
  } catch {
    return null;
  }
  if (loc.protocol !== "https:") return null;
  if (loc.username || loc.password) return null;
  if (loc.hostname.toLowerCase() !== new URL(base).hostname.toLowerCase()) {
    return null;
  }
  const basePort = new URL(base).port || "443";
  const locPort = loc.port || "443";
  if (basePort !== locPort) return null;
  return `${base}${loc.pathname || "/"}${loc.search}`;
}
