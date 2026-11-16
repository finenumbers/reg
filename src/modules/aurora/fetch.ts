/**
 * One GET of a saved Aurora link. The name is resolved first.
 * A private address is not connected. The body is not written to disk.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Readable, type Duplex } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { logger } from "@/lib/logger";
import { isGlobalAddress } from "@/modules/aurora/url";

export const AURORA_BODY_CAP = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type AuroraFetchFailure = {
  ok: false;
  error: string;
  retryable: boolean;
  interrupted?: boolean;
  status: number;
};

export type AuroraFetchSuccess = { ok: true; bytes: Uint8Array; status: number };

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

const CLOSED = "Ссылка ведёт на закрытый адрес.";
const QUIET = "Ссылка не отвечает.";
const REJECTED = "Ссылка отклонена.";
const REDIRECT = "Ссылка перенаправляет. Укажите прямой адрес.";
const OVERSIZE = "Файл больше 20 МБ.";
const INTERRUPTED = "Загрузка прервана.";

export function auroraInterruptedMessage(): string {
  return INTERRUPTED;
}

function failure(
  error: string,
  retryable: boolean,
  status = 0,
  interrupted = false,
): AuroraFetchFailure {
  return { ok: false, error, retryable, status, ...(interrupted ? { interrupted: true } : {}) };
}

export async function resolveAuroraHost(
  host: string,
  lookup: Lookup = defaultLookup,
): Promise<{ ok: true; addresses: ResolvedAddress[] } | AuroraFetchFailure> {
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host);
  } catch {
    return failure(QUIET, true);
  }
  if (records.length === 0) return failure(QUIET, true);
  const addresses: ResolvedAddress[] = [];
  for (const record of records) {
    if (!isGlobalAddress(record.address)) return failure(CLOSED, false);
    addresses.push({ address: record.address, family: record.family === 6 ? 6 : 4 });
  }
  return { ok: true, addresses };
}

async function defaultLookup(host: string): Promise<{ address: string; family: number }[]> {
  return dnsLookup(host, { all: true, verbatim: true });
}

export function collectCapped(
  chunks: readonly Uint8Array[],
  cap = AURORA_BODY_CAP,
): AuroraFetchSuccess | AuroraFetchFailure {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  if (total > cap) return failure(OVERSIZE, false);
  if (total === 0) return failure(QUIET, true);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes, status: 200 };
}

function decoder(encoding: string | undefined): Duplex | "identity" | "reject" {
  const value = (encoding ?? "").trim().toLowerCase();
  if (!value || value === "identity") return "identity";
  if (value === "gzip" || value === "x-gzip") return createGunzip();
  if (value === "deflate") return createInflate();
  if (value === "br") return createBrotliDecompress();
  return "reject";
}

function readStream(stream: Readable, cap: number): Promise<AuroraFetchSuccess | AuroraFetchFailure> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: AuroraFetchSuccess | AuroraFetchFailure) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    stream.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > cap) {
        stream.destroy();
        finish(failure(OVERSIZE, false));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => finish(collectCapped(chunks, cap)));
    stream.on("error", () => finish(failure(QUIET, true)));
  });
}

export function fetchAuroraOnce(
  href: string,
  host: string,
  address: ResolvedAddress,
  signal: AbortSignal,
): Promise<AuroraFetchSuccess | AuroraFetchFailure> {
  if (signal.aborted) return Promise.resolve(failure(INTERRUPTED, false, 0, true));
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1, rejectUnauthorized: true });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AuroraFetchSuccess | AuroraFetchFailure) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      agent.destroy();
      resolve(result);
    };
    const onAbort = () => {
      req.destroy();
      finish(failure(INTERRUPTED, false, 0, true));
    };
    const req = https.request(
      href,
      {
        method: "GET",
        servername: isIP(host) ? undefined : host,
        rejectUnauthorized: true,
        timeout: TIMEOUT_MS,
        agent,
        headers: {
          Accept: "text/csv, text/plain, */*",
          "Accept-Encoding": "gzip, deflate, br, identity",
        },
        lookup: ((_hostname, options, callback) => {
          const family = address.family;
          if (options && typeof options === "object" && "all" in options && options.all) {
            callback(null, [{ address: address.address, family }]);
            return;
          }
          callback(null, address.address, family);
        }) as https.RequestOptions["lookup"],
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          finish(failure(REDIRECT, false, status));
          return;
        }
        if (status >= 500) {
          response.resume();
          finish(failure(QUIET, true, status));
          return;
        }
        if (status !== 200) {
          response.resume();
          finish(failure(REJECTED, false, status));
          return;
        }
        const coding = decoder(response.headers["content-encoding"]);
        if (coding === "reject") {
          response.resume();
          finish(failure(REJECTED, false, status));
          return;
        }
        const source = coding === "identity" ? response : response.pipe(coding);
        void readStream(source, AURORA_BODY_CAP).then((result) => {
          if (!result.ok && result.error === OVERSIZE) response.destroy();
          finish({ ...result, status });
        });
      },
    );
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", () => {
      req.destroy();
      finish(failure(QUIET, true));
    });
    req.on("error", () => finish(failure(QUIET, true)));
    req.end();
  });
}

export type AuroraOnce = typeof fetchAuroraOnce;

/** Two attempts at most. A closed address, a redirect, and an HTTP 4xx do not repeat. */
export async function downloadAuroraCsv(
  link: { href: string; host: string },
  signal: AbortSignal,
  deps?: {
    resolve?: typeof resolveAuroraHost;
    once?: AuroraOnce;
  },
): Promise<AuroraFetchSuccess | AuroraFetchFailure> {
  const resolve = deps?.resolve ?? resolveAuroraHost;
  const once = deps?.once ?? fetchAuroraOnce;
  let last = failure(QUIET, true);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal.aborted) return failure(INTERRUPTED, false, 0, true);
    const started = Date.now();
    const resolved = await resolve(link.host);
    if (!resolved.ok) {
      logger.info("aurora.fetch", { status: 0, attempt, durationMs: Date.now() - started });
      if (!resolved.retryable || resolved.interrupted) return resolved;
      last = resolved;
      continue;
    }
    const address = resolved.addresses[0];
    if (!address) return failure(QUIET, true);
    const result = await once(link.href, link.host, address, signal);
    logger.info("aurora.fetch", {
      status: result.status,
      attempt,
      durationMs: Date.now() - started,
    });
    if (result.ok || !result.retryable || result.interrupted) return result;
    last = result;
  }
  return last;
}
