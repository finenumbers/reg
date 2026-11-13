/**
 * One POST of a 10-digit number to the public NIC Telecom BDPN form.
 * The host, path, and field name are literals. No retry and no redirect.
 */

import { logger } from "@/lib/logger";
import { readCappedBody } from "@/modules/rtu-soap/body";
import {
  BdpnLookupError,
  acceptedBdpnNumber,
  parseBdpnHtml,
  type BdpnLookup,
} from "@/modules/bdpn/parse";

export const BDPN_LOOKUP_URL = "https://www.nic-t.ru/bdpn/bdpn-proverka-nomera/";
export const BDPN_TIMEOUT_MS = 15_000;
export const BDPN_BODY_CAP = 1024 * 1024;

const INVALID_MESSAGE = "Номер БДПН: ровно 10 цифр, первая 3, 4, 8 или 9.";
const REDIRECT_MESSAGE = "БДПН: сервис ответил перенаправлением.";
const TIMEOUT_MESSAGE = "БДПН: сервис не ответил вовремя.";
const NETWORK_MESSAGE = "БДПН: нет соединения с сервисом.";
const OVERSIZE_MESSAGE = "БДПН: ответ больше допустимого размера.";
const ABORTED_MESSAGE = "БДПН: проверка прервана.";

function transportError(error: unknown, caller?: AbortSignal): BdpnLookupError {
  if (caller?.aborted) {
    return new BdpnLookupError("ABORTED", ABORTED_MESSAGE);
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new BdpnLookupError("TIMEOUT", TIMEOUT_MESSAGE);
  }
  return new BdpnLookupError("NETWORK", NETWORK_MESSAGE);
}

function stayedOnPinnedHost(response: Response): boolean {
  if (!response.url) return true;
  try {
    const url = new URL(response.url);
    return url.protocol === "https:" && url.host === "www.nic-t.ru";
  } catch {
    return false;
  }
}

export async function lookupBdpnNumber(
  raw: string,
  caller?: AbortSignal,
): Promise<BdpnLookup> {
  const number = acceptedBdpnNumber(raw);
  if (!number) {
    throw new BdpnLookupError("INVALID", INVALID_MESSAGE);
  }
  if (caller?.aborted) {
    throw new BdpnLookupError("ABORTED", ABORTED_MESSAGE);
  }

  const started = Date.now();
  const timeout = AbortSignal.timeout(BDPN_TIMEOUT_MS);
  const signal = caller ? AbortSignal.any([timeout, caller]) : timeout;
  let response: Response;
  try {
    response = await fetch(BDPN_LOOKUP_URL, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `num=${number}`,
    });
  } catch (error) {
    logger.info("bdpn.lookup", { durationMs: Date.now() - started });
    throw transportError(error, caller);
  }

  const redirected =
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400) ||
    !stayedOnPinnedHost(response);
  if (redirected) {
    await response.body?.cancel().catch(() => undefined);
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw new BdpnLookupError("REDIRECT", REDIRECT_MESSAGE, response.status);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw new BdpnLookupError(
      "HTTP_ERROR",
      `БДПН: HTTP ${response.status}`,
      response.status,
    );
  }

  let capped: Awaited<ReturnType<typeof readCappedBody>>;
  try {
    capped = await readCappedBody(response, BDPN_BODY_CAP);
  } catch (error) {
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw transportError(error, caller);
  }
  if (!capped.ok) {
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw new BdpnLookupError("BAD_RESPONSE", OVERSIZE_MESSAGE, response.status);
  }

  try {
    const lookup = parseBdpnHtml(capped.text, number);
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
      found: lookup.found,
    });
    return lookup;
  } catch (error) {
    logger.info("bdpn.lookup", {
      status: response.status,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
