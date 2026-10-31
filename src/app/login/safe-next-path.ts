/** Post-login path. A backslash or whitespace is another origin in the URL parser. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || /[\u0000-\u0020]/.test(raw)) return "/";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u0020]/.test(decoded)
  ) {
    return "/";
  }
  return raw;
}
