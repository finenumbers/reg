/**
 * One GET to shop.mcn.ru or vpbx.mcn.ru. Redirects are not followed.
 * A transport failure, a timeout, an empty body, non-JSON, and HTTP 5xx retry once.
 */

import https from "node:https";
import {
  BAD_COUNTRY,
  parseCountries,
  parseFreePage,
  parseFreeTotal,
  parsePurchasedPage,
  parsePurchasedTotal,
  type CallMeta,
  type CountryRef,
  type FreeRow,
} from "@/modules/mcn/parse";
import {
  FREE_PAGE_LIMIT,
  authorizationHeader,
  countriesUrl,
  freeUrl,
  platformRequest,
  purchasedUrl,
} from "@/modules/mcn/url";

const BODY_CAP = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const REJECTED = "Площадка отклонила запрос.";
const NO_ANSWER = "Площадка не ответила.";
const TOO_BIG = "Ответ площадки слишком большой.";
const INTERRUPTED = "Загрузка прервана.";
const BAD_SECRET = "Ключ не читается.";

export type TransportResult = {
  status: number;
  body: string;
  tooBig?: boolean;
  interrupted?: boolean;
  failed?: boolean;
};

export type Transport = (
  url: string,
  token: string,
  signal: AbortSignal,
) => Promise<TransportResult>;

export type NumberPage<T> =
  | { ok: true; rows: T[]; total: number; echo: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

export type TotalPage =
  | { ok: true; total: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

export type CountriesPage =
  | { ok: true; countries: CountryRef[]; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

const EMPTY_META: CallMeta = { status: 0, attempts: 0, durationMs: 0 };

function metaOf(status: number, attempts: number, started: number): CallMeta {
  return { status, attempts, durationMs: Date.now() - started };
}

function tokenReadable(token: string): boolean {
  return token.length >= 1 && token.length <= 4096 && !/[\r\n]/.test(token);
}

export function httpsGet(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<TransportResult> {
  const request = platformRequest(url);
  if (!request || !tokenReadable(token)) {
    return Promise.resolve({ status: 0, body: "", failed: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      req.destroy();
      finish({ status: 0, body: "", interrupted: true });
    };
    const agent = new https.Agent({
      keepAlive: false,
      maxSockets: 1,
      rejectUnauthorized: true,
    });
    const req = https.request(
      {
        protocol: "https:",
        hostname: request.hostname,
        port: 443,
        method: request.method,
        path: request.path,
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(token),
        },
        servername: request.servername,
        agent,
        rejectUnauthorized: true,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > BODY_CAP) {
            tooBig = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          agent.destroy();
          finish({
            status,
            body: tooBig ? "" : Buffer.concat(chunks).toString("utf8"),
            tooBig,
          });
        });
        res.on("error", () => {
          agent.destroy();
          finish({ status, body: "", failed: true });
        });
      },
    );
    if (signal.aborted) {
      onAbort();
      agent.destroy();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      finish({ status: 0, body: "", failed: true });
    });
    req.on("error", () => {
      agent.destroy();
      finish({ status: 0, body: "", failed: true });
    });
    req.end();
  });
}

type RawCall =
  | { ok: true; data: unknown; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

async function callJson(
  url: string,
  token: string,
  transport: Transport,
): Promise<RawCall> {
  if (!tokenReadable(token)) {
    return { ok: false, error: BAD_SECRET, meta: EMPTY_META };
  }
  const started = Date.now();
  let attempts = 0;
  let last: RawCall = {
    ok: false,
    error: NO_ANSWER,
    meta: metaOf(0, 0, started),
  };
  for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
    attempts += 1;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let result: TransportResult;
    try {
      result = await transport(url, token, signal);
    } catch {
      last = { ok: false, error: NO_ANSWER, meta: metaOf(0, attempts, started) };
      continue;
    }
    if (result.tooBig) {
      return {
        ok: false,
        error: TOO_BIG,
        meta: metaOf(result.status, attempts, started),
      };
    }
    if (result.status >= 300 && result.status < 500) {
      return {
        ok: false,
        error: REJECTED,
        meta: metaOf(result.status, attempts, started),
      };
    }
    if (
      result.interrupted ||
      result.failed ||
      result.status === 0 ||
      result.status >= 500 ||
      result.body.trim() === ""
    ) {
      last = {
        ok: false,
        error: result.interrupted ? INTERRUPTED : NO_ANSWER,
        meta: metaOf(result.status, attempts, started),
      };
      continue;
    }
    if (result.status !== 200) {
      return {
        ok: false,
        error: REJECTED,
        meta: metaOf(result.status, attempts, started),
      };
    }
    try {
      const data = JSON.parse(result.body) as unknown;
      return { ok: true, data, meta: metaOf(result.status, attempts, started) };
    } catch {
      last = {
        ok: false,
        error: "Ответ площадки не разобран.",
        meta: metaOf(result.status, attempts, started),
      };
    }
  }
  return last;
}

export type McnClient = {
  purchased(offset: number, limit: number): Promise<NumberPage<string>>;
  purchasedRecount(): Promise<TotalPage>;
  countries(): Promise<CountriesPage>;
  free(countryCode: number, pageNumber: number): Promise<NumberPage<FreeRow>>;
  freeRecount(countryCode: number): Promise<TotalPage>;
};

export function createMcnClient(
  token: string,
  options?: { transport?: Transport },
): McnClient {
  const transport = options?.transport ?? httpsGet;
  const refused = (): { ok: false; error: string; meta: CallMeta } | null =>
    tokenReadable(token) ? null : { ok: false, error: BAD_SECRET, meta: EMPTY_META };

  return {
    async purchased(offset, limit) {
      const blocked = refused();
      if (blocked) return blocked;
      const url = purchasedUrl(offset, limit);
      if (!url)
        return { ok: false, error: "Ответ площадки не разобран.", meta: EMPTY_META };
      const raw = await callJson(url, token, transport);
      if (!raw.ok) return raw;
      const parsed = parsePurchasedPage(raw.data, limit, offset);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return {
        ok: true,
        rows: parsed.rows,
        total: parsed.total,
        echo: parsed.offset,
        meta: raw.meta,
      };
    },
    async purchasedRecount() {
      const blocked = refused();
      if (blocked) return blocked;
      const url = purchasedUrl(0, 1);
      if (!url)
        return { ok: false, error: "Ответ площадки не разобран.", meta: EMPTY_META };
      const raw = await callJson(url, token, transport);
      if (!raw.ok) return raw;
      const parsed = parsePurchasedTotal(raw.data, 0);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, total: parsed.total, meta: raw.meta };
    },
    async countries() {
      const blocked = refused();
      if (blocked) return blocked;
      const raw = await callJson(countriesUrl(), token, transport);
      if (!raw.ok) return raw;
      const parsed = parseCountries(raw.data);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, countries: parsed.countries, meta: raw.meta };
    },
    async free(countryCode, pageNumber) {
      const blocked = refused();
      if (blocked) return blocked;
      const url = freeUrl(countryCode, pageNumber);
      if (!url) return { ok: false, error: BAD_COUNTRY, meta: EMPTY_META };
      const raw = await callJson(url, token, transport);
      if (!raw.ok) return raw;
      const parsed = parseFreePage(raw.data, FREE_PAGE_LIMIT);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return {
        ok: true,
        rows: parsed.rows,
        total: parsed.total,
        echo: pageNumber,
        meta: raw.meta,
      };
    },
    async freeRecount(countryCode) {
      const blocked = refused();
      if (blocked) return blocked;
      const url = freeUrl(countryCode, 1);
      if (!url) return { ok: false, error: BAD_COUNTRY, meta: EMPTY_META };
      const raw = await callJson(url, token, transport);
      if (!raw.ok) return raw;
      const parsed = parseFreeTotal(raw.data);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, total: parsed.total, meta: raw.meta };
    },
  };
}
