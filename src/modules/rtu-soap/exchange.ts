import { readCappedBody } from "@/modules/rtu-soap/body";
import {
  classifyTlsCodes,
  collectErrorCodes,
  parseRtuCaPem,
  tlsFailureDetail,
} from "@/modules/rtu-soap/ca";
import { tlsRequest } from "@/modules/rtu-soap/tls-fetch";

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export type RtuExchange =
  | { ok: true; status: number; text: string }
  | { ok: false; detail: string };

/**
 * One HTTPS call to the pinned RTU origin. Redirects are not followed.
 * A pasted PEM is trusted only by this call, same as the access check.
 */
export async function rtuExchange(input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  caPem: string | null;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): Promise<RtuExchange> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const storedCa = input.caPem ?? "";
  if (storedCa.length > 0) {
    const parsed = parseRtuCaPem(storedCa);
    if (!parsed.ok) return { ok: false, detail: "Сохранённый сертификат не разбирается." };
    const result = await tlsRequest({
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: input.body,
      caPem: parsed.ca.pem,
      fingerprints: parsed.ca.certs.map((cert) => cert.fingerprint256),
      timeoutMs: input.timeoutMs,
      maxBytes,
    });
    if (!result.ok) return { ok: false, detail: result.detail };
    return { ok: true, status: result.status, text: result.text };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(input.url, {
      method: input.method,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: input.headers,
      body: input.body,
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: true, status: response.status, text: "" };
    }
    const capped = await readCappedBody(response, maxBytes);
    if (!capped.ok) return { ok: false, detail: "Ответ больше допустимого размера." };
    return { ok: true, status: response.status, text: capped.text };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, detail: "Коммутатор не ответил вовремя." };
    }
    const kind = classifyTlsCodes(collectErrorCodes(error));
    if (kind) return { ok: false, detail: tlsFailureDetail(kind) };
    return { ok: false, detail: "Нет соединения с коммутатором." };
  }
}
