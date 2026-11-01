import { listDidFreeNumbers, DidClientError } from "@/modules/did/client";
import { loadDidCredentials } from "@/modules/did/credentials";
import {
  DID_NOT_CONFIGURED_MESSAGE,
  DID_TEST_TIMEOUT_MS,
} from "@/modules/did/types";

export type DidTestResultView = {
  result: "success" | "error";
  detail: string | null;
  durationMs: number;
};

export async function runDidConnectionTest(): Promise<DidTestResultView> {
  const started = Date.now();
  const creds = await loadDidCredentials();
  if (!creds) {
    return {
      result: "error",
      detail: DID_NOT_CONFIGURED_MESSAGE,
      durationMs: Date.now() - started,
    };
  }

  try {
    const page = await listDidFreeNumbers(
      { page: 1, pageSize: 1, filters: {}, phoneQ: "" },
      creds,
      DID_TEST_TIMEOUT_MS,
    );
    return {
      result: "success",
      detail: `Каталог отвечает, свободных номеров: ${page.total}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const detail =
      error instanceof DidClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "DID: ошибка проверки";
    return { result: "error", detail, durationMs: Date.now() - started };
  }
}
