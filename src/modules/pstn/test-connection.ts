import { lookupPstnPhone, PstnLookupError } from "@/modules/pstn/client";
import { loadPstnCredentials } from "@/modules/pstn/credentials";
import { PSTN_TEST_PHONE, PSTN_TEST_TIMEOUT_MS } from "@/modules/pstn/types";

export type PstnTestResultView = {
  result: "success" | "error";
  detail: string | null;
  durationMs: number;
};

export async function runPstnConnectionTest(): Promise<PstnTestResultView> {
  const started = Date.now();
  const creds = await loadPstnCredentials();
  if (!creds) {
    return {
      result: "error",
      detail:
        "Сначала сохраните URL сервиса PSTN и API-ключ, затем проверьте соединение",
      durationMs: Date.now() - started,
    };
  }

  try {
    const fields = await lookupPstnPhone(
      PSTN_TEST_PHONE,
      creds,
      PSTN_TEST_TIMEOUT_MS,
    );
    const durationMs = Date.now() - started;
    if (!fields.found) {
      return {
        result: "success",
        detail: `lookup ${PSTN_TEST_PHONE}: номер не найден в справочнике (ключ принят)`,
        durationMs,
      };
    }
    const bits = [fields.operator, fields.garTerritory].filter(Boolean);
    return {
      result: "success",
      detail:
        bits.length > 0
          ? `lookup ${PSTN_TEST_PHONE}: ${bits.join(" · ")}`
          : `lookup ${PSTN_TEST_PHONE} успешен`,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail =
      error instanceof PstnLookupError
        ? error.message
        : error instanceof Error
          ? error.message
          : "PSTN: ошибка проверки";
    return { result: "error", detail, durationMs };
  }
}
