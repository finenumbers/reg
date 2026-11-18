/**
 * One POST to api.voximplant.com. The body is empty. Redirects are not followed.
 * A transport failure, an empty body, non-JSON, and HTTP 5xx retry once.
 */

import https from "node:https";
import { TokenCache, type VoximplantCredentials } from "@/modules/voximplant/auth";
import {
  BAD_CATEGORY,
  BAD_REGION,
  parseCategories,
  parseFreePage,
  parsePurchasedPage,
  parseRegions,
  type CallMeta,
  type FreeRow,
  type PhoneCategory,
  type PhoneRegion,
} from "@/modules/voximplant/parse";
import {
  categoriesUrl,
  freeUrl,
  platformRequest,
  purchasedUrl,
  regionsUrl,
} from "@/modules/voximplant/url";

const BODY_CAP = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const REJECTED = "Площадка отклонила запрос.";
const NO_ANSWER = "Площадка не ответила.";
const TOO_BIG = "Ответ площадки слишком большой.";
const INTERRUPTED = "Загрузка прервана.";

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
  | { ok: true; rows: T[]; total: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

export type TotalPage =
  | { ok: true; total: number; meta: CallMeta }
  | { ok: false; error: string; meta: CallMeta };

type DirectoryPage<T> =
  ({ ok: true; meta: CallMeta } & T) | { ok: false; error: string; meta: CallMeta };

const EMPTY_META: CallMeta = { status: 0, attempts: 0, durationMs: 0 };

function metaOf(status: number, attempts: number, started: number): CallMeta {
  return { status, attempts, durationMs: Date.now() - started };
}

function httpsPost(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<TransportResult> {
  const request = platformRequest(url);
  if (!request) return Promise.resolve({ status: 0, body: "", failed: true });
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
          Authorization: `Bearer ${token}`,
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
    if (result.status >= 400 && result.status < 500) {
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

type VoximplantClient = {
  purchased(offset: number, count: number): Promise<NumberPage<FreeRow>>;
  purchasedRecount(): Promise<TotalPage>;
  categories(): Promise<DirectoryPage<{ categories: PhoneCategory[] }>>;
  regions(category: string): Promise<DirectoryPage<{ regions: PhoneRegion[] }>>;
  free(
    category: string,
    regionId: number,
    offset: number,
    count: number,
  ): Promise<NumberPage<FreeRow>>;
  freeRecount(category: string, regionId: number): Promise<TotalPage>;
};

export function createVoximplantClient(
  creds: VoximplantCredentials,
  options?: { transport?: Transport; now?: () => number },
): VoximplantClient {
  const transport = options?.transport ?? httpsPost;
  const now = options?.now ?? (() => Math.floor(Date.now() / 1000));
  const cache = new TokenCache();
  const token = () => cache.sign(creds, now());

  return {
    async purchased(offset, count) {
      const raw = await callJson(purchasedUrl(offset, count), token(), transport);
      if (!raw.ok) return raw;
      const parsed = parsePurchasedPage(raw.data, count);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, rows: parsed.rows, total: parsed.total, meta: raw.meta };
    },
    async purchasedRecount() {
      const raw = await callJson(purchasedUrl(0, 1), token(), transport);
      if (!raw.ok) return raw;
      const parsed = parsePurchasedPage(raw.data, 1);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, total: parsed.total, meta: raw.meta };
    },
    async categories() {
      const raw = await callJson(categoriesUrl(), token(), transport);
      if (!raw.ok) return raw;
      const parsed = parseCategories(raw.data);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, categories: parsed.categories, meta: raw.meta };
    },
    async regions(category) {
      const url = regionsUrl(category);
      if (!url) return { ok: false, error: BAD_CATEGORY, meta: EMPTY_META };
      const raw = await callJson(url, token(), transport);
      if (!raw.ok) return raw;
      const parsed = parseRegions(raw.data);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, regions: parsed.regions, meta: raw.meta };
    },
    async free(category, regionId, offset, count) {
      const url = freeUrl(category, regionId, offset, count);
      if (!url) {
        return {
          ok: false,
          error: freeUrl(category, 0, offset, count) ? BAD_REGION : BAD_CATEGORY,
          meta: EMPTY_META,
        };
      }
      const raw = await callJson(url, token(), transport);
      if (!raw.ok) return raw;
      const parsed = parseFreePage(raw.data, count);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, rows: parsed.rows, total: parsed.total, meta: raw.meta };
    },
    async freeRecount(category, regionId) {
      const url = freeUrl(category, regionId, 0, 1);
      if (!url) return { ok: false, error: BAD_CATEGORY, meta: EMPTY_META };
      const raw = await callJson(url, token(), transport);
      if (!raw.ok) return raw;
      const parsed = parseFreePage(raw.data, 1);
      if (!parsed.ok) return { ok: false, error: parsed.error, meta: raw.meta };
      return { ok: true, total: parsed.total, meta: raw.meta };
    },
  };
}
