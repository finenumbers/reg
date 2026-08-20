/**
 * HTTP client for GeoIP Analytics POST /api/v1/lookup (GRCHC LPM).
 */

import { logger } from "@/lib/logger";
import {
  GEOIP_LOOKUP_TIMEOUT_MS,
  geoipLookupUrl,
  mapLookupResponse,
  type GeoFields,
  type GeoipCredentials,
} from "@/modules/geoip/types";

export type GeoipLookupErrorCode =
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "NOT_READY";

export class GeoipLookupError extends Error {
  constructor(
    public readonly code: GeoipLookupErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GeoipLookupError";
  }
}

export async function lookupIpGeo(
  ip: string,
  creds: GeoipCredentials,
  timeoutMs: number = GEOIP_LOOKUP_TIMEOUT_MS,
): Promise<GeoFields> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(geoipLookupUrl(creds.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": creds.apiKey,
        "X-GeoIP-Client-Auth": "1",
      },
      body: JSON.stringify({
        ip,
        include: ["city", "country", "asn"],
      }),
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    if (res.status === 401) {
      throw new GeoipLookupError(
        "UNAUTHORIZED",
        "GeoIP: неверный или отсутствующий API-ключ",
        401,
      );
    }
    if (res.status === 503) {
      throw new GeoipLookupError(
        "NOT_READY",
        "GeoIP: сервис не готов (датасет / MV)",
        503,
      );
    }
    if (res.status === 429) {
      throw new GeoipLookupError("HTTP_ERROR", "GeoIP: превышен rate limit", 429);
    }
    if (!res.ok) {
      throw new GeoipLookupError(
        "HTTP_ERROR",
        `GeoIP lookup HTTP ${res.status}`,
        res.status,
      );
    }

    const body: unknown = await res.json();
    logger.debug("geoip.lookup_ok", { ip, durationMs });
    return mapLookupResponse(body);
  } catch (error) {
    if (error instanceof GeoipLookupError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeoipLookupError("TIMEOUT", "GeoIP: истекло время ожидания");
    }
    throw new GeoipLookupError(
      "NETWORK",
      error instanceof Error ? error.message : "GeoIP: сетевая ошибка",
    );
  } finally {
    clearTimeout(timer);
  }
}
