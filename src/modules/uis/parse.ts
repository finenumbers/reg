/**
 * JSON-RPC pages. A number is the digit string the tariff split already accepts.
 * The error value is never copied out: the handbook echoes the access token there.
 */

import { sipoutDidDigits } from "@/modules/sipout/did";
import { ACCESS_LIMIT, type UisList } from "@/modules/uis/url";

export type UisRow = {
  e164: string;
  incomingPurchase: string;
  incomingPeriod: string;
};

export type PageStep = "done" | "next" | "short" | "over";

export type RpcOk = {
  ok: true;
  total: number;
  rows: UisRow[] | null;
  dayRemaining: number | null;
  minuteRemaining: number | null;
  minuteReset: number | null;
};

type RpcFail = {
  ok: false;
  error: string;
  minuteWait: number | null;
};

const BAD_PAGE = "Ответ площадки не разобран.";
const BAD_NUMBER = "Номер не принят.";
const DUPLICATE = "В ответе повторяется номер.";

export function uisDigits(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return null;
    return sipoutDidDigits(String(raw));
  }
  if (typeof raw === "string") return sipoutDidDigits(raw);
  return null;
}

function moneyText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "";
    const text = String(value);
    return /^\d+(\.\d+)?$/.test(text) ? text : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : "";
  }
  return "";
}

function sameId(actual: unknown, expected: number): boolean {
  if (typeof actual === "number") return actual === expected;
  if (typeof actual === "string") return actual === String(expected);
  return false;
}

export function scrubUisText(token: string, text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (token && flat.includes(token)) return null;
  if (/:\/\/|bearer|password|token|key=|access_token/i.test(flat)) return null;
  return flat.slice(0, 200);
}

function mnemonicText(token: string, value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z0-9_]+$/.test(value)) return null;
  return scrubUisText(token, value);
}

function limitType(params: unknown): "minute" | "day" | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const kind = (params as { limit_type?: unknown }).limit_type;
  if (kind === "minute" || kind === "day") return kind;
  return null;
}

function integerField(source: unknown, key: string): number | null | "bad" {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return "bad";
  return value;
}

function limitsOf(metadata: unknown):
  | RpcFail
  | {
      dayRemaining: number | null;
      minuteRemaining: number | null;
      minuteReset: number | null;
    } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { dayRemaining: null, minuteRemaining: null, minuteReset: null };
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, "limits")) {
    return { dayRemaining: null, minuteRemaining: null, minuteReset: null };
  }
  const limits = (metadata as { limits?: unknown }).limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  const day = integerField(limits, "day_remaining");
  const minute = integerField(limits, "minute_remaining");
  const reset = integerField(limits, "minute_reset");
  if (day === "bad" || minute === "bad" || reset === "bad") {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  return { dayRemaining: day, minuteRemaining: minute, minuteReset: reset };
}

function errorText(token: string, body: Record<string, unknown>): RpcFail {
  const error = body.error;
  const record =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : null;
  const data =
    record?.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null;
  const mnemonic = mnemonicText(token, data?.mnemonic);
  const message =
    typeof record?.message === "string" ? scrubUisText(token, record.message) : null;
  const text =
    [mnemonic, message].filter(Boolean).join(". ") || "Площадка отклонила запрос.";
  const kind = limitType(data?.params);
  const meta = limitsOf(data?.metadata);
  if ("ok" in meta) return { ok: false, error: text, minuteWait: null };
  const wait =
    mnemonic === "limit_exceeded" &&
    kind === "minute" &&
    meta.minuteReset != null &&
    meta.minuteReset <= 90
      ? meta.minuteReset
      : null;
  if (mnemonic === "limit_exceeded" && wait == null) {
    return {
      ok: false,
      error: kind === "day" ? "Дневная квота исчерпана." : "Минутная квота исчерпана.",
      minuteWait: null,
    };
  }
  return { ok: false, error: text, minuteWait: wait };
}

export function parseRpc(
  data: unknown,
  id: number,
  token: string,
  list: UisList,
  mode: "count" | "read",
  limit: number,
): RpcOk | RpcFail {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  const body = data as Record<string, unknown>;
  if (body.jsonrpc !== "2.0" || !sameId(body.id, id)) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  if ("error" in body && body.error != null) return errorText(token, body);
  if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  const result = body.result as { metadata?: unknown; data?: unknown };
  const metadata = result.metadata;
  const total =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { total_items?: unknown }).total_items
      : undefined;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  if (!Array.isArray(result.data) || result.data.length > limit) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  if (total === 0 && result.data.length !== 0) {
    return { ok: false, error: BAD_PAGE, minuteWait: null };
  }
  if (result.data.length > total) return { ok: false, error: BAD_PAGE, minuteWait: null };
  const quota = limitsOf(metadata);
  if ("ok" in quota) return quota;
  if (quota.dayRemaining === 0) {
    return { ok: false, error: "Дневная квота исчерпана.", minuteWait: null };
  }
  if (mode === "count") {
    if (total > 0 && result.data.length === 0) {
      return { ok: false, error: BAD_PAGE, minuteWait: null };
    }
    return { ok: true, total, rows: null, ...quota };
  }
  const rows = readRows(result.data, list);
  if (typeof rows === "string") return { ok: false, error: rows, minuteWait: null };
  return { ok: true, total, rows, ...quota };
}

function readRows(data: unknown[], list: UisList): UisRow[] | string {
  const field = list === "purchased" ? "virtual_phone_number" : "phone_number";
  const seen = new Set<string>();
  const rows: UisRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return BAD_PAGE;
    const record = item as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, field)) return BAD_NUMBER;
    const e164 = uisDigits(record[field]);
    if (!e164) return BAD_NUMBER;
    if (seen.has(e164)) return DUPLICATE;
    seen.add(e164);
    rows.push({
      e164,
      incomingPurchase: list === "free" ? moneyText(record.onetime_payment) : "",
      incomingPeriod: list === "free" ? moneyText(record.monthly_charge) : "",
    });
  }
  return rows;
}

export function acceptPage(input: {
  total: number;
  got: number;
  acceptedBefore: number;
  limit: number;
}): PageStep {
  if (input.got > input.limit) return "over";
  const accepted = input.acceptedBefore + input.got;
  if (accepted > input.total) return "over";
  if (accepted === input.total) return "done";
  if (input.got < input.limit) return "short";
  return "next";
}

/** The access page may be the first page of a longer list. A short page is not access. */
export function accessPageOk(total: number, got: number): boolean {
  if (got > ACCESS_LIMIT) return false;
  if (total === 0) return got === 0;
  if (got === 0) return false;
  if (got === total) return true;
  return got === ACCESS_LIMIT && got < total;
}
