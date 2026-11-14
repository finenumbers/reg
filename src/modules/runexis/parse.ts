/**
 * One showcase page. A bad number fails the page. Nothing is dropped.
 */

import { isTariffNumberAdmitted } from "@/modules/traffic/tariff-match";
import { SHOWCASE_LIMIT } from "@/modules/runexis/url";

const INCOMPLETE = "Ответ площадки обрезан.";
const BAD_NUMBER = "В ответе есть номер, который нельзя записать.";

export type ShowcaseNumbers = {
  total: number;
  page: number;
  limit: number;
  numbers: string[];
};

export type ParsedShowcase =
  { ok: true; page: ShowcaseNumbers } | { ok: false; error: string };

export type PageStep = "done" | "next" | "short" | "over";

function safeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** Digits of code and number, unchanged. A leading 7 is not added. */
export function nationalDigits(code: unknown, number: unknown): string | null {
  if (typeof code !== "string" || typeof number !== "string") return null;
  if (!/^\d+$/.test(code) || !/^\d+$/.test(number)) return null;
  const digits = `${code}${number}`;
  if (!isTariffNumberAdmitted(digits)) return null;
  return digits;
}

export function parseShowcasePage(data: unknown): ParsedShowcase {
  if (!data || typeof data !== "object") return { ok: false, error: INCOMPLETE };
  const body = data as {
    success?: unknown;
    data?: unknown;
    meta?: { total?: unknown; page?: unknown; limit?: unknown };
  };
  if (body.success !== true || !Array.isArray(body.data) || !body.meta) {
    return { ok: false, error: INCOMPLETE };
  }
  const total = safeCount(body.meta.total);
  const page = safeCount(body.meta.page);
  const limit = safeCount(body.meta.limit);
  if (total == null || page == null || page < 1 || limit !== SHOWCASE_LIMIT) {
    return { ok: false, error: INCOMPLETE };
  }
  const numbers: string[] = [];
  for (const item of body.data) {
    if (!item || typeof item !== "object") return { ok: false, error: BAD_NUMBER };
    const row = item as { code?: unknown; number?: unknown };
    const digits = nationalDigits(row.code, row.number);
    if (!digits) return { ok: false, error: BAD_NUMBER };
    numbers.push(digits);
  }
  return { ok: true, page: { total, page, limit, numbers } };
}

/**
 * A short page is the end only when the accepted count lands on total.
 * Anything else is not a full showcase.
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

export function parseAccessToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { success?: unknown; data?: { token?: unknown } };
  if (body.success !== true) return null;
  const token = body.data?.token;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192) return null;
  if (/\s/.test(token)) return null;
  return token;
}
