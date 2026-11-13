/**
 * Calltrace text on the OPRS screen: the safe leg's id, or «открыть».
 * The host rules match `new URL(url).host` for http(s) links: userinfo is
 * dropped, the host is lowercased, and the default port is removed.
 */

import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";

export function oprsGuiHost(guiBase: string): string {
  const trimmed = guiBase.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.host.toLowerCase();
  } catch {
    return "";
  }
}

/** Host as the screen's safety check sees it. Empty when the URL is not http(s). */
export function oprsUrlHost(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url.trim());
  if (!match) return "";
  const scheme = match[1]!.toLowerCase();
  if (scheme !== "http" && scheme !== "https") return "";
  let authority = match[2] ?? "";
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  authority = authority.toLowerCase();
  if (scheme === "https" && authority.endsWith(":443")) {
    authority = authority.slice(0, -":443".length);
  } else if (scheme === "http" && authority.endsWith(":80")) {
    authority = authority.slice(0, -":80".length);
  }
  return authority;
}

/** The word in the Calltrace cell. An unsafe or empty link is blank. */
export function oprsCalltraceToken(url: string, cdrId: string, guiBase: string): string {
  if (!url.trim() || !guiBase.trim()) return "";
  if (!isSafeVoipmonitorHref(url, guiBase)) return "";
  const id = cdrId.trim();
  return id || "открыть";
}
