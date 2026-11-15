/**
 * One DIDAPI catalog page. A bad number fails the page. A bad price does not.
 */

import { isTariffNumberAdmitted } from "@/modules/traffic/tariff-match";
import { SHOWCASE_LIMIT } from "@/modules/runexis/url";

const INCOMPLETE = "Ответ площадки обрезан.";
const BAD_NUMBER = "В ответе есть номер, который нельзя записать.";
const BAD_STATUS = "В ответе нет статуса номера.";

const PURCHASE_KEYS = ["installation_cost", "installationCost", "buy_price"] as const;
const MERA_KEYS = ["mera_price", "meraPrice"] as const;
const PERIOD_KEYS = ["subscription_fee", "subscriptionFee", "period_price"] as const;

export type FreeDraft = {
  e164: string;
  incomingPurchase: string;
  incomingPeriod: string;
};

export type ShowcaseNumbers = {
  total: number;
  page: number;
  limit: number;
  rows: FreeDraft[];
};

export type ManagementNumbers = {
  total: number;
  page: number;
  limit: number;
  read: number;
  skippedFree: number;
  rows: string[];
};

export type ParsedShowcase =
  { ok: true; page: ShowcaseNumbers } | { ok: false; error: string };

export type ParsedManagement =
  { ok: true; page: ManagementNumbers } | { ok: false; error: string };

export type PageStep = "done" | "next" | "short" | "over";

export type RunexisSession = {
  token: string;
  refreshToken: string;
};

function safeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function digitText(value: unknown): string | null {
  if (typeof value === "string") return /^\d+$/.test(value) ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

/** Eleven digits starting with 7. A number that is already that shape is kept. */
export function nationalDigits(code: unknown, number: unknown): string | null {
  const local = digitText(number);
  if (!local) return null;
  if (local.length === 11 && local.startsWith("7")) {
    return isTariffNumberAdmitted(local) ? local : null;
  }
  const prefix = digitText(code);
  if (!prefix) return null;
  const digits = `7${prefix}${local}`;
  if (!/^7\d{10}$/.test(digits)) return null;
  return digits;
}

function moneyText(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const text = String(value);
    return /^\d+(\.\d+)?$/.test(text) ? text : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

function presentMoney(
  row: Record<string, unknown>,
  keys: readonly string[],
): { found: boolean; text: string } {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value == null) continue;
    return { found: true, text: moneyText(value) ?? "" };
  }
  return { found: false, text: "" };
}

export function freePrices(row: Record<string, unknown>): {
  incomingPurchase: string;
  incomingPeriod: string;
} {
  const purchase = presentMoney(row, PURCHASE_KEYS);
  const mera = presentMoney(row, MERA_KEYS);
  return {
    incomingPurchase: purchase.found ? purchase.text : mera.text,
    incomingPeriod: presentMoney(row, PERIOD_KEYS).text,
  };
}

function pageMeta(
  data: unknown,
): { total: number; page: number; limit: number; rows: unknown[] } | null {
  if (!data || typeof data !== "object") return null;
  const body = data as {
    success?: unknown;
    data?: unknown;
    meta?: { total?: unknown; page?: unknown; limit?: unknown };
  };
  if (body.success !== true || !Array.isArray(body.data) || !body.meta) return null;
  const total = safeCount(body.meta.total);
  const page = safeCount(body.meta.page);
  const limit = safeCount(body.meta.limit);
  if (total == null || page == null || page < 1 || limit !== SHOWCASE_LIMIT) return null;
  return { total, page, limit, rows: body.data };
}

export function parseShowcasePage(data: unknown): ParsedShowcase {
  const meta = pageMeta(data);
  if (!meta) return { ok: false, error: INCOMPLETE };
  const rows: FreeDraft[] = [];
  for (const item of meta.rows) {
    if (!item || typeof item !== "object") return { ok: false, error: BAD_NUMBER };
    const row = item as Record<string, unknown>;
    const e164 = nationalDigits(row.code, row.number);
    if (!e164) return { ok: false, error: BAD_NUMBER };
    rows.push({ e164, ...freePrices(row) });
  }
  return {
    ok: true,
    page: { total: meta.total, page: meta.page, limit: meta.limit, rows },
  };
}

export function parseManagementPage(data: unknown): ParsedManagement {
  const meta = pageMeta(data);
  if (!meta) return { ok: false, error: INCOMPLETE };
  const rows: string[] = [];
  let skippedFree = 0;
  for (const item of meta.rows) {
    if (!item || typeof item !== "object") return { ok: false, error: BAD_NUMBER };
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (!status || typeof status !== "object") return { ok: false, error: BAD_STATUS };
    const mnemonic = (status as { mnemonic?: unknown }).mnemonic;
    if (typeof mnemonic !== "string" || mnemonic.trim() === "") {
      return { ok: false, error: BAD_STATUS };
    }
    const e164 = nationalDigits(row.code, row.number);
    if (!e164) return { ok: false, error: BAD_NUMBER };
    if (mnemonic.trim().toLowerCase() === "free") {
      skippedFree += 1;
      continue;
    }
    rows.push(e164);
  }
  return {
    ok: true,
    page: {
      total: meta.total,
      page: meta.page,
      limit: meta.limit,
      read: meta.rows.length,
      skippedFree,
      rows,
    },
  };
}

/**
 * A short page is the end only when the accepted count lands on total.
 * Anything else is not a full list.
 */
export function acceptShowcasePage(input: {
  total: number;
  got: number;
  acceptedBefore: number;
}): PageStep {
  if (input.got > SHOWCASE_LIMIT) return "over";
  const accepted = input.acceptedBefore + input.got;
  if (accepted > input.total) return "over";
  if (accepted === input.total) return "done";
  if (input.got < SHOWCASE_LIMIT) return "short";
  return "next";
}

function tokenText(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 8192) return null;
  if (/\s/.test(value)) return null;
  return value;
}

export function parseAccessToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { success?: unknown; data?: { token?: unknown } };
  if (body.success !== true) return null;
  return tokenText(body.data?.token);
}

export function parseSession(data: unknown): RunexisSession | null {
  const token = parseAccessToken(data);
  if (!token || !data || typeof data !== "object") return null;
  const refresh = (data as { data?: { refresh_token?: unknown } }).data?.refresh_token;
  return { token, refreshToken: tokenText(refresh) ?? "" };
}
