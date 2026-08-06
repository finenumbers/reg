/**
 * Parse phones.sync stdout JSON from softswitch export.py.
 */

import {
  ENDPOINT_HEADERS,
  GATEWAY_HEADERS,
  type ParsedPhoneEndpoint,
  type ParsedPhoneGateway,
  type ParsedPhonesPayload,
  type PhoneRowData,
} from "@/modules/phones/types";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function pickRow(
  raw: unknown,
  headers: readonly string[],
): PhoneRowData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const data: PhoneRowData = {};
  for (const h of headers) {
    data[h] = asString(obj[h]);
  }
  return data;
}

function headersOrDefault(
  raw: unknown,
  fallback: readonly string[],
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...fallback];
  const cleaned = raw
    .map((h) => (typeof h === "string" ? h.trim() : ""))
    .filter((h) => h.length > 0);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

/**
 * Parse and validate export.py JSON. Throws on structural failures.
 * Empty endpoints+gateways arrays are allowed (valid empty snapshot).
 */
export function parsePhonesStdout(stdout: string): ParsedPhonesPayload {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) {
    throw new Error("Empty phones.sync stdout");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Some environments may wrap JSON with noise — try first {..} slice.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("phones.sync stdout is not valid JSON");
    }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error("phones.sync stdout is not valid JSON");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("phones.sync JSON root must be an object");
  }

  const root = parsed as Record<string, unknown>;
  const version =
    typeof root.version === "number" && Number.isFinite(root.version)
      ? root.version
      : 1;

  const endpointHeaders = headersOrDefault(
    root.endpointHeaders,
    ENDPOINT_HEADERS,
  );
  const gatewayHeaders = headersOrDefault(
    root.gatewayHeaders,
    GATEWAY_HEADERS,
  );

  if (!Array.isArray(root.endpoints) || !Array.isArray(root.gateways)) {
    throw new Error("phones.sync JSON must include endpoints[] and gateways[]");
  }

  const endpoints: ParsedPhoneEndpoint[] = [];
  for (const item of root.endpoints) {
    const data = pickRow(item, endpointHeaders);
    if (!data) continue;
    const name = data["Название"]?.trim() ?? "";
    if (!name) continue;
    const endpointNumberRaw =
      data["Номер оконечного оборудования"]?.trim() ?? "";
    endpoints.push({
      name,
      endpointNumber: endpointNumberRaw.length > 0 ? endpointNumberRaw : null,
      data,
    });
  }

  const gateways: ParsedPhoneGateway[] = [];
  for (const item of root.gateways) {
    const data = pickRow(item, gatewayHeaders);
    if (!data) continue;
    const name = data["Название"]?.trim() ?? "";
    if (!name) continue;
    gateways.push({ name, data });
  }

  return {
    version,
    endpointHeaders,
    gatewayHeaders,
    endpoints,
    gateways,
  };
}
