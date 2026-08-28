import type { CardUrlParts } from "@/modules/voipmonitor/types";
import { digits } from "@/modules/voipmonitor/normalize";

export function buildCardUrl(
  template: string,
  guiBase: string,
  parts: CardUrlParts,
): string {
  const base = guiBase.trim().replace(/\/+$/, "");
  const tpl = template.trim().replace(/^['"]|['"]$/g, "");
  if (!base) return "";
  if (!tpl) {
    const filter = cardFilter(parts);
    if (!filter) return "";
    return `${base}/admin.php?cdr_filter=${encodeURIComponent(filter)}`;
  }
  const replaced = tpl
    .replaceAll("{gui_base}", base)
    .replaceAll("{voipmonitor_cdr_id}", digits(parts.cdrId ?? ""))
    .replaceAll("{voipmonitor_call_id}", escapeJsonString(parts.callId));
  return encodeCdrFilterQuery(replaced);
}

export function rewriteLegacyCardUrl(
  cardUrl: string,
  guiBase: string,
  vmCallId: string,
  callDate: Date | null,
): string {
  if (!vmCallId) return cardUrl;
  const legacy =
    cardUrl === "" ||
    cardUrl.includes("fId:") ||
    cardUrl.includes("fId%3A") ||
    cardUrl.includes("fId%3a");
  if (!legacy) return cardUrl;
  let base = guiBase;
  if (!base) base = guiBaseFromCardUrl(cardUrl);
  if (!base) return cardUrl;
  return buildCardUrl("", base, { callId: vmCallId, callDate });
}

export function cardFilter(parts: CardUrlParts): string {
  if (!parts.callId) return "";
  let quoted: string;
  try {
    quoted = JSON.stringify(parts.callId);
  } catch {
    return "";
  }
  let filter = `{fcallid:${quoted}`;
  if (parts.callDate && !Number.isNaN(parts.callDate.getTime())) {
    const from = formatFilterDate(
      new Date(parts.callDate.getTime() - 24 * 60 * 60 * 1000),
    );
    const to = formatFilterDate(
      new Date(parts.callDate.getTime() + 24 * 60 * 60 * 1000),
    );
    filter += `,"fdatefrom":"${from}","fdateto":"${to}"`;
  }
  return `${filter}}`;
}

function formatFilterDate(value: Date): string {
  const utc = new Date(value.getTime());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
}

function guiBaseFromCardUrl(cardUrl: string): string {
  try {
    const parsed = new URL(cardUrl);
    if (!parsed.protocol || !parsed.host) return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function encodeCdrFilterQuery(raw: string): string {
  const key = "cdr_filter=";
  const index = raw.indexOf(key);
  if (index < 0) return raw;
  const prefix = raw.slice(0, index + key.length);
  const value = raw.slice(index + key.length).replace(/^['"]|['"]$/g, "");
  if (!value) return raw;
  if (value.includes("%7B") || value.includes("%7b")) return prefix + value;
  return prefix + encodeURIComponent(value);
}

function escapeJsonString(value: string): string {
  try {
    return JSON.stringify(value).slice(1, -1);
  } catch {
    return value;
  }
}

export function isSafeVoipmonitorHref(
  url: string,
  guiBase: string,
): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const allowed = new URL(guiBase.trim());
    return parsed.host === allowed.host;
  } catch {
    return false;
  }
}
