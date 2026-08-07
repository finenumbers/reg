/**
 * Parse phones.sync stdout JSON from softswitch export.py.
 * Fail-closed: any corrupt/invalid row throws — caller must not apply.
 */

import { stripAnsi } from "@/lib/strip-ansi";
import {
  ENDPOINT_HEADERS,
  GATEWAY_HEADERS,
  REGISTRATION_FIELD,
  REGISTRATION_NO,
  REGISTRATION_YES,
  type ParsedPhoneEndpoint,
  type ParsedPhoneGateway,
  type ParsedPhonesPayload,
  type PhoneRowData,
} from "@/modules/phones/types";

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
  // Always pull critical fields from the raw object even if headers omit them.
  for (const required of [
    "Название",
    "Номер оконечного оборудования",
    REGISTRATION_FIELD,
  ] as const) {
    if (required in obj) {
      data[required] = asString(obj[required]);
    }
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
  if (cleaned.length === 0) return [...fallback];
  const seen = new Set(cleaned);
  const merged = [...cleaned];
  for (const h of fallback) {
    if (!seen.has(h)) {
      merged.push(h);
      seen.add(h);
    }
  }
  return merged;
}

function assertNoReplacementChars(stdout: string): void {
  if (stdout.includes("\uFFFD")) {
    throw new Error(
      "phones.sync stdout contains U+FFFD (UTF-8 corruption) — snapshot rejected",
    );
  }
}

function optionalCount(root: Record<string, unknown>, key: string): number | null {
  const v = root[key];
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

/**
 * Parse and validate export.py JSON. Throws on structural or row failures.
 * Empty endpoints+gateways arrays are allowed (valid empty snapshot).
 */
export function parsePhonesStdout(stdout: string): ParsedPhonesPayload {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) {
    throw new Error("Empty phones.sync stdout");
  }

  assertNoReplacementChars(cleaned);

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
  for (let i = 0; i < root.endpoints.length; i++) {
    const item = root.endpoints[i];
    const data = pickRow(item, endpointHeaders);
    if (!data) {
      throw new Error(`phones.sync endpoints[${i}] is not an object`);
    }
    const name = data["Название"]?.trim() ?? "";
    if (!name) {
      throw new Error(`phones.sync endpoints[${i}] missing Название`);
    }
    const registration = data[REGISTRATION_FIELD]?.trim() ?? "";
    if (registration !== REGISTRATION_YES && registration !== REGISTRATION_NO) {
      throw new Error(
        `phones.sync endpoints[${i}] (${name}): Регистрация must be «Да» or «Нет», got ${JSON.stringify(registration)}`,
      );
    }
    data[REGISTRATION_FIELD] = registration;
    const endpointNumberRaw =
      data["Номер оконечного оборудования"]?.trim() ?? "";
    endpoints.push({
      name,
      endpointNumber: endpointNumberRaw.length > 0 ? endpointNumberRaw : null,
      data,
    });
  }

  const gateways: ParsedPhoneGateway[] = [];
  for (let i = 0; i < root.gateways.length; i++) {
    const item = root.gateways[i];
    const data = pickRow(item, gatewayHeaders);
    if (!data) {
      throw new Error(`phones.sync gateways[${i}] is not an object`);
    }
    const name = data["Название"]?.trim() ?? "";
    if (!name) {
      throw new Error(`phones.sync gateways[${i}] missing Название`);
    }
    gateways.push({ name, data });
  }

  const declaredEndpoints = optionalCount(root, "endpointCount");
  const declaredGateways = optionalCount(root, "gatewayCount");
  if (declaredEndpoints != null && declaredEndpoints !== endpoints.length) {
    throw new Error(
      `phones.sync endpointCount mismatch: declared ${declaredEndpoints}, got ${endpoints.length}`,
    );
  }
  if (declaredGateways != null && declaredGateways !== gateways.length) {
    throw new Error(
      `phones.sync gatewayCount mismatch: declared ${declaredGateways}, got ${gateways.length}`,
    );
  }

  return {
    version,
    endpointHeaders,
    gatewayHeaders,
    endpoints,
    gateways,
  };
}
