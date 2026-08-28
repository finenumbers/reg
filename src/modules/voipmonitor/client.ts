import { parseNaiveDateTime } from "@/modules/enrich/dates";
import {
  HTTP_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  RANGE_FETCH_CONCURRENCY,
  RANGE_MIN_SLICE_MS,
  RANGE_SLICE_MS,
  RATE_LIMIT_PER_SEC,
} from "@/modules/voipmonitor/constants";
import { looksLikeResultCap } from "@/modules/voipmonitor/probe-budget";
import type { RangeFetchMeta, VmCall } from "@/modules/voipmonitor/types";

export type VoipmonitorClientConfig = {
  apiUrl: string;
  user: string;
  password: string;
  timeoutMs?: number;
  rateLimitPerSec?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
};

function apiEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("voipmonitor API URL is not configured");
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("/php/api.php") || lower.endsWith("/api.php")) {
    return trimmed;
  }
  if (lower.endsWith("/php")) return `${trimmed}/api.php`;
  return `${trimmed}/php/api.php`;
}

function firstString(
  row: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    const text = String(value).trim();
    if (text && text !== "<nil>") return text;
  }
  return "";
}

function firstInt(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function firstTime(
  row: Record<string, unknown>,
  ...keys: string[]
): Date | null {
  for (const key of keys) {
    const text = firstString(row, key);
    if (!text) continue;
    const parsed = parseNaiveDateTime(text);
    if (parsed) return parsed;
  }
  return null;
}

function mapVmCalls(rows: Record<string, unknown>[]): VmCall[] {
  const out: VmCall[] = [];
  for (const row of rows) {
    const call: VmCall = {
      cdrId: firstString(row, "cdrId", "cdr_id", "ID"),
      callId: firstString(row, "callId", "callid", "fcallid"),
      caller: firstString(row, "caller", "sipcaller"),
      called: firstString(row, "called", "sipcalled"),
      sipCallerIp: firstString(row, "sipcallerip", "callerip"),
      sipCalledIp: firstString(row, "sipcalledip", "calledip"),
      duration: firstInt(row, "duration"),
      connectDuration: firstInt(row, "connect_duration", "connectduration"),
      callDate: firstTime(row, "calldate", "callDate", "start"),
      callEnd: firstTime(row, "callend", "callEnd", "end"),
    };
    if (!call.cdrId && !call.callId) continue;
    out.push(call);
  }
  return out;
}

function isEmptyEnvelope(envelope: Record<string, unknown>): boolean {
  const msg = firstString(envelope, "error", "msg", "message").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("no match") ||
    msg.includes("not found") ||
    msg.includes("no cdr") ||
    msg.includes("no calls")
  );
}

function apiErrorMessage(envelope: Record<string, unknown>): string {
  if (!("success" in envelope)) return "";
  const success = envelope.success;
  let failed = false;
  if (typeof success === "boolean") failed = !success;
  else if (typeof success === "string") {
    failed = !(success.toLowerCase() === "true" || success === "1");
  } else return "";
  if (!failed) return "";
  if (isEmptyEnvelope(envelope)) return "";
  return firstString(envelope, "error", "msg", "message") || "request failed";
}

export function parseVoipCallsResponse(payload: string): VmCall[] {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === "null") return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return mapVmCalls(parsed as Record<string, unknown>[]);
  }
  if (parsed && typeof parsed === "object") {
    const envelope = parsed as Record<string, unknown>;
    if (isEmptyEnvelope(envelope)) return [];
    const err = apiErrorMessage(envelope);
    if (err) throw new Error(`voipmonitor API: ${err}`);
    for (const key of ["cdr", "results", "data", "rows"]) {
      const nested = envelope[key];
      if (Array.isArray(nested)) {
        return mapVmCalls(nested as Record<string, unknown>[]);
      }
    }
    return mapVmCalls([envelope]);
  }
  throw new Error("decode voipmonitor response");
}

function formatApiTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

export class VoipmonitorClient {
  private nextSlot = 0;
  lastRangeMeta: RangeFetchMeta | null = null;

  constructor(private readonly config: VoipmonitorClientConfig) {}

  private async throttle(): Promise<void> {
    const perSec = this.config.rateLimitPerSec ?? RATE_LIMIT_PER_SEC;
    if (perSec <= 0) return;
    const minGap = 1000 / perSec;
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + minGap;
    const wait = start - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  async getVoipCalls(params: Record<string, unknown>): Promise<VmCall[]> {
    const { calls, clipped } = await this.fetchCalls(params);
    if (clipped) {
      throw new Error("voipmonitor API response truncated");
    }
    return calls;
  }

  async listVoipCallsRange(from: Date, to: Date): Promise<VmCall[]> {
    const start = from;
    let end = to;
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 1000);
    }
    const slices: Array<{ from: number; to: number }> = [];
    for (let cursor = start.getTime(); cursor < end.getTime(); ) {
      const next = Math.min(cursor + RANGE_SLICE_MS, end.getTime());
      slices.push({ from: cursor, to: next });
      if (next === end.getTime()) break;
      cursor = next;
    }
    const meta: RangeFetchMeta = {
      sliceSplits: 0,
      clipped: false,
      suspectedCap: false,
    };
    const limit = new Semaphore(RANGE_FETCH_CONCURRENCY);
    const parts = await Promise.all(
      slices.map((slice) =>
        this.fetchSliceAdaptive(slice.from, slice.to, meta, limit),
      ),
    );
    const seen = new Set<string>();
    const out: VmCall[] = [];
    for (const hits of parts) {
      for (const hit of hits) {
        const key =
          hit.cdrId ||
          `${hit.callId}|${hit.callDate?.toISOString() ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
      }
    }
    this.lastRangeMeta = meta;
    return out;
  }

  private async fetchSliceAdaptive(
    fromMs: number,
    toMs: number,
    meta: RangeFetchMeta,
    limit: Semaphore,
  ): Promise<VmCall[]> {
    const { calls, clipped } = await limit.run(() =>
      this.fetchCalls({
        startTime: formatApiTime(new Date(fromMs)),
        startTimeTo: formatApiTime(new Date(toMs)),
      }),
    );
    const capped = looksLikeResultCap(calls.length);
    const shouldSplit =
      (clipped || capped) && toMs - fromMs > RANGE_MIN_SLICE_MS;
    if (shouldSplit) {
      meta.sliceSplits += 1;
      if (clipped) meta.clipped = true;
      if (capped) meta.suspectedCap = true;
      const mid = fromMs + Math.floor((toMs - fromMs) / 2);
      const [left, right] = await Promise.all([
        this.fetchSliceAdaptive(fromMs, mid, meta, limit),
        this.fetchSliceAdaptive(mid, toMs, meta, limit),
      ]);
      return [...left, ...right];
    }
    if (clipped) {
      throw new Error("voipmonitor API response truncated");
    }
    if (capped) meta.suspectedCap = true;
    return calls;
  }

  private async fetchCalls(
    params: Record<string, unknown>,
  ): Promise<{ calls: VmCall[]; clipped: boolean }> {
    const { text, clipped } = await this.postTask("getVoipCalls", params);
    if (clipped) return { calls: [], clipped: true };
    return { calls: parseVoipCallsResponse(text), clipped: false };
  }

  private async postTask(
    task: string,
    params: Record<string, unknown>,
  ): Promise<{ text: string; clipped: boolean }> {
    if (!this.config.apiUrl.trim()) {
      throw new Error("voipmonitor API URL is not configured");
    }
    await this.throttle();
    const endpoint = apiEndpoint(this.config.apiUrl);
    const body = new URLSearchParams();
    body.set("task", task);
    body.set("user", this.config.user);
    body.set("password", this.config.password);
    body.set("params", JSON.stringify(params));
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? HTTP_TIMEOUT_MS,
    );
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
      const text = await res.text();
      const maxBytes = this.config.maxResponseBytes ?? MAX_RESPONSE_BYTES;
      const clipped = text.length > maxBytes;
      const bodyText = clipped ? text.slice(0, maxBytes) : text;
      if (res.status >= 300) {
        throw new Error(
          `voipmonitor API HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
        );
      }
      return { text: bodyText, clipped };
    } finally {
      clearTimeout(timeout);
    }
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export { apiEndpoint };
