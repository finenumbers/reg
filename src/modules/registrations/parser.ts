/**
 * Parser for check_regs.sh stdout.
 *
 * Expected line format (ANSI colors from TTY mode are stripped):
 *   phone;Registered|Unregistered;ip:port|
 *
 * Examples:
 *   73852222205;Registered;46.20.69.189:5060
 *   73912193303;Unregistered;
 *   78622606009;\x1b[32mRegistered\x1b[0m;\x1b[35m5.227.161.172:5060\x1b[0m
 *
 * Malformed lines are skipped at parse time (counted as linesBad).
 * Callers must refuse apply when linesBad > 0 (fail-closed).
 * Duplicate phones in one payload: last wins + counter.
 */

export type RegStatusValue = "Registered" | "Unregistered";

export type ParsedRegistrationRow = {
  phone: string;
  status: RegStatusValue;
  ip: string | null;
  port: number | null;
  /** Original non-empty line after ANSI strip (trimmed) for debug */
  rawLine: string;
};

export type ParseRegsResult = {
  rows: ParsedRegistrationRow[];
  linesTotal: number;
  linesBad: number;
  duplicatePhones: number;
  badLines: Array<{ line: string; reason: string }>;
};

import { stripAnsi } from "@/lib/strip-ansi";

const STATUS_VALUES = new Set<string>(["Registered", "Unregistered"]);

/** IPv4:port — matches examples from softswitch output; no hostname inference. */
const ENDPOINT_PATTERN =
  /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function parseEndpoint(endpoint: string): {
  ok: true;
  ip: string | null;
  port: number | null;
} | { ok: false; reason: string } {
  if (endpoint === "") {
    return { ok: true, ip: null, port: null };
  }

  const match = ENDPOINT_PATTERN.exec(endpoint);
  if (!match) {
    return { ok: false, reason: "endpoint must be empty or IPv4:port" };
  }

  const ip = match[1]!;
  const port = Number(match[2]);
  if (!isValidIpv4(ip)) {
    return { ok: false, reason: "invalid IPv4 address" };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: "port out of range" };
  }
  return { ok: true, ip, port };
}

/**
 * Parse a single CSV-like line. Returns null when the line should be skipped.
 */
export function parseRegsLine(
  line: string,
): { ok: true; row: ParsedRegistrationRow } | { ok: false; reason: string } {
  const trimmed = stripAnsi(line).replace(/\r/g, "").trim();
  if (trimmed === "") {
    return { ok: false, reason: "empty line" };
  }

  const parts = trimmed.split(";");
  // Allow trailing empty field after final semicolon: phone;status;endpoint
  if (parts.length < 3) {
    return { ok: false, reason: "expected phone;status;endpoint" };
  }
  if (parts.length > 3) {
    return { ok: false, reason: "too many fields" };
  }

  const phone = parts[0]!.trim();
  const statusRaw = parts[1]!.trim();
  const endpoint = parts[2]!.trim();

  if (!phone) {
    return { ok: false, reason: "empty phone" };
  }
  // Safe phone: no whitespace / control / semicolon leftovers.
  if (!/^[A-Za-z0-9+._-]+$/.test(phone)) {
    return { ok: false, reason: "invalid phone characters" };
  }

  if (!STATUS_VALUES.has(statusRaw)) {
    return { ok: false, reason: "status must be Registered or Unregistered" };
  }
  const status = statusRaw as RegStatusValue;

  const endpointParsed = parseEndpoint(endpoint);
  if (!endpointParsed.ok) {
    return { ok: false, reason: endpointParsed.reason };
  }

  return {
    ok: true,
    row: {
      phone,
      status,
      ip: endpointParsed.ip,
      port: endpointParsed.port,
      rawLine: trimmed,
    },
  };
}

/**
 * Parse full stdout from check_regs.sh.
 * Empty input yields zero rows (caller decides whether that is a hard failure).
 */
export function parseRegsStdout(stdout: string): ParseRegsResult {
  const lines = stdout.split(/\r?\n/);
  const byPhone = new Map<string, ParsedRegistrationRow>();
  let duplicatePhones = 0;
  let linesTotal = 0;
  const badLines: Array<{ line: string; reason: string }> = [];

  for (const line of lines) {
    if (stripAnsi(line).replace(/\r/g, "").trim() === "") continue;
    linesTotal += 1;
    const parsed = parseRegsLine(line);
    if (!parsed.ok) {
      badLines.push({
        line: stripAnsi(line).replace(/\r/g, "").trim(),
        reason: parsed.reason,
      });
      continue;
    }
    if (byPhone.has(parsed.row.phone)) {
      duplicatePhones += 1;
    }
    byPhone.set(parsed.row.phone, parsed.row);
  }

  return {
    rows: Array.from(byPhone.values()),
    linesTotal,
    linesBad: badLines.length,
    duplicatePhones,
    badLines,
  };
}
