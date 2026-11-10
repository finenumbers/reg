/** Canonical Zabbix JSON-RPC URL. Empty input clears the setting. */

export function parseZabbixApiUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (!url.hostname) return null;
  if (url.pathname.split("/").includes("..")) return null;

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path.endsWith("/api_jsonrpc.php")) {
    path = `${path === "/" ? "" : path}/api_jsonrpc.php`;
  }
  return `https://${url.host}${path}`;
}
