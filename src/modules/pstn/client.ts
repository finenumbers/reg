/**
 * HTTP client for PSTN Analytics GET /api/v1/lookup.
 */

import { logger } from "@/lib/logger";
import {
  PSTN_LOOKUP_TIMEOUT_MS,
  mapPstnLookupResponse,
  pstnLookupUrl,
  type PstnCredentials,
  type PstnFields,
} from "@/modules/pstn/types";

export type PstnLookupErrorCode =
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "NOT_READY"
  | "RATE_LIMITED";

export class PstnLookupError extends Error {
  constructor(
    public readonly code: PstnLookupErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "PstnLookupError";
  }
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (!raw) return undefined;
  const sec = Number.parseInt(raw, 10);
  return Number.isFinite(sec) && sec > 0 ? sec : undefined;
}

export async function lookupPstnPhone(
  phone: string,
  creds: PstnCredentials,
  timeoutMs: number = PSTN_LOOKUP_TIMEOUT_MS,
): Promise<PstnFields> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(pstnLookupUrl(creds.baseUrl, phone), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": creds.apiKey,
      },
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    if (res.status === 401) {
      throw new PstnLookupError(
        "UNAUTHORIZED",
        "PSTN: неверный или отсутствующий API-ключ",
        401,
      );
    }
    if (res.status === 503) {
      throw new PstnLookupError(
        "NOT_READY",
        "PSTN: сервис не готов",
        503,
      );
    }
    if (res.status === 429) {
      throw new PstnLookupError(
        "RATE_LIMITED",
        "PSTN: превышен rate limit",
        429,
        retryAfterSeconds(res),
      );
    }
    if (res.status === 404) {
      logger.debug("pstn.lookup_not_found", { phone, durationMs });
      return { found: false, operator: null, garTerritory: null };
    }
    if (res.status === 409) {
      logger.debug("pstn.lookup_ambiguous", { phone, durationMs });
      return { found: false, operator: null, garTerritory: null };
    }
    if (!res.ok) {
      throw new PstnLookupError(
        "HTTP_ERROR",
        `PSTN lookup HTTP ${res.status}`,
        res.status,
      );
    }

    const body: unknown = await res.json();
    logger.debug("pstn.lookup_ok", { phone, durationMs });
    return mapPstnLookupResponse(body);
  } catch (error) {
    if (error instanceof PstnLookupError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PstnLookupError("TIMEOUT", "PSTN: истекло время ожидания");
    }
    throw new PstnLookupError(
      "NETWORK",
      error instanceof Error ? error.message : "PSTN: сетевая ошибка",
    );
  } finally {
    clearTimeout(timer);
  }
}
