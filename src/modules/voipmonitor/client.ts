import {
  HTTP_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  RATE_LIMIT_PER_SEC,
} from "@/modules/voipmonitor/constants";
import type { VmCall } from "@/modules/voipmonitor/types";

export type VoipmonitorClientConfig = {
  apiUrl: string;
  user: string;
  password: string;
  timeoutMs?: number;
  rateLimitPerSec?: number;
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

const TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

function firstTime(
  row: Record<string, unknown>,
  ...keys: string[]
): Date | null {
  for (const key of keys) {
    const text = firstString(row, key);
    if (!text) continue;
    const iso = Date.parse(text);
    if (Number.isFinite(iso)) return new Date(iso);
    const match = TIME_RE.exec(text);
    if (match) {
      return new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
      );
    }
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
  private lastRequest = 0;

  constructor(private readonly config: VoipmonitorClientConfig) {}

  private async throttle(): Promise<void> {
    const perSec = this.config.rateLimitPerSec ?? RATE_LIMIT_PER_SEC;
    if (perSec <= 0) return;
    const minGap = 1000 / perSec;
    const wait = minGap - (Date.now() - this.lastRequest);
    if (this.lastRequest && wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequest = Date.now();
  }

  async getVoipCalls(params: Record<string, unknown>): Promise<VmCall[]> {
    const payload = await this.postTask("getVoipCalls", params);
    return parseVoipCallsResponse(payload);
  }

  async listVoipCallsRange(from: Date, to: Date): Promise<VmCall[]> {
    const start = from;
    let end = to;
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 1000);
    }
    const slice = 15 * 60 * 1000;
    const seen = new Set<string>();
    const out: VmCall[] = [];
    for (let cursor = start.getTime(); cursor < end.getTime(); ) {
      const next = Math.min(cursor + slice, end.getTime());
      const hits = await this.getVoipCalls({
        startTime: formatApiTime(new Date(cursor)),
        startTimeTo: formatApiTime(new Date(next)),
      });
      for (const hit of hits) {
        const key =
          hit.cdrId ||
          `${hit.callId}|${hit.callDate?.toISOString() ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
      }
      if (next === end.getTime()) break;
      cursor = next;
    }
    return out;
  }

  private async postTask(
    task: string,
    params: Record<string, unknown>,
  ): Promise<string> {
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
      const clipped =
        text.length > MAX_RESPONSE_BYTES
          ? text.slice(0, MAX_RESPONSE_BYTES)
          : text;
      if (res.status >= 300) {
        throw new Error(
          `voipmonitor API HTTP ${res.status}: ${clipped.slice(0, 200)}`,
        );
      }
      return clipped;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { apiEndpoint };
