import { lookupIpGeo, GeoipLookupError } from "@/modules/geoip/client";
import { loadGeoipCredentials } from "@/modules/geoip/credentials";
import { GEOIP_TEST_IP } from "@/modules/geoip/types";

export type GeoipTestResultView = {
  result: "success" | "error";
  detail: string | null;
  durationMs: number;
};

export async function runGeoipConnectionTest(): Promise<GeoipTestResultView> {
  const started = Date.now();
  const creds = await loadGeoipCredentials();
  if (!creds) {
    return {
      result: "error",
      detail:
        "Сначала сохраните URL сервиса GeoIP и API-ключ, затем проверьте соединение",
      durationMs: Date.now() - started,
    };
  }

  try {
    const fields = await lookupIpGeo(GEOIP_TEST_IP, creds);
    const bits = [
      fields.country,
      fields.city,
      fields.isp,
    ].filter(Boolean);
    const durationMs = Date.now() - started;
    return {
      result: "success",
      detail:
        bits.length > 0
          ? `lookup ${GEOIP_TEST_IP}: ${bits.join(" · ")}`
          : `lookup ${GEOIP_TEST_IP} успешен (пустые секции ГРЧЦ)`,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail =
      error instanceof GeoipLookupError
        ? error.message
        : error instanceof Error
          ? error.message
          : "GeoIP: ошибка проверки";
    return { result: "error", detail, durationMs };
  }
}
