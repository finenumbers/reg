import { readCappedBody } from "@/modules/rtu-soap/body";
import { classifyTlsCodes, collectErrorCodes } from "@/modules/rtu-soap/ca";

/** One JSON-RPC reply. Two hours of one-second points stay under this. */
export const ZABBIX_BODY_CAP = 4 * 1024 * 1024;

export type ZabbixFailureKind =
  | "timeout"
  | "tls"
  | "network"
  | "redirect"
  | "status"
  | "size"
  | "json"
  | "rpc";

export class ZabbixFailure extends Error {
  readonly kind: ZabbixFailureKind;

  constructor(kind: ZabbixFailureKind, message: string) {
    super(message);
    this.name = "ZabbixFailure";
    this.kind = kind;
  }
}

const METHODS = new Set([
  "apiinfo.version",
  "user.login",
  "user.logout",
  "host.get",
  "graph.get",
  "item.get",
  "history.get",
]);

export function zabbixRpcBody(input: {
  id: number;
  method: string;
  params: Record<string, unknown>;
  auth: string | null;
}): string {
  if (!METHODS.has(input.method)) {
    throw new ZabbixFailure("rpc", "Zabbix отказал.");
  }
  const payload: Record<string, unknown> = {
    jsonrpc: "2.0",
    method: input.method,
    params: input.params,
    id: input.id,
  };
  if (input.auth) payload.auth = input.auth;
  return JSON.stringify(payload);
}

export function zabbixHeaders(
  auth: { token: string; bearer: boolean } | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (auth?.bearer) headers.Authorization = `Bearer ${auth.token}`;
  return headers;
}

function tlsText(kind: "issuer" | "name" | "expired" | "other"): string {
  if (kind === "issuer") return "Сертификат Zabbix не доверенный.";
  if (kind === "name") return "Имя в сертификате не совпадает с адресом.";
  if (kind === "expired") return "Срок сертификата недействителен.";
  return "Соединение TLS оборвалось.";
}

function rpcText(error: unknown): string {
  if (!error || typeof error !== "object") return "Zabbix отказал.";
  const row = error as { message?: unknown; data?: unknown };
  const message = typeof row.message === "string" ? row.message : "";
  const data = typeof row.data === "string" ? row.data : "";
  const text = `${message} ${data}`.replace(/\s+/g, " ").trim();
  return text.slice(0, 180) || "Zabbix отказал.";
}

/**
 * One POST to the saved api_jsonrpc.php. Redirects are not followed.
 * The request body is never attached to an error.
 */
export async function zabbixPost(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: input.signal,
      headers: input.headers,
      body: input.body,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ZabbixFailure("timeout", "Zabbix не ответил вовремя.");
    }
    const kind = classifyTlsCodes(collectErrorCodes(error));
    if (kind) throw new ZabbixFailure("tls", tlsText(kind));
    throw new ZabbixFailure("network", "Нет соединения с Zabbix.");
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new ZabbixFailure("redirect", "Адрес Zabbix перенаправил запрос.");
  }

  const type = response.headers.get("content-type") ?? "";
  if (type && !type.toLowerCase().includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new ZabbixFailure("json", "Адрес API не отвечает JSON.");
  }

  const capped = await readCappedBody(response, ZABBIX_BODY_CAP);
  if (!capped.ok) throw new ZabbixFailure("size", "Ответ Zabbix больше допустимого размера.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(capped.text);
  } catch {
    throw new ZabbixFailure("json", "Адрес API не отвечает JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ZabbixFailure("json", "Адрес API не отвечает JSON.");
  }
  const envelope = parsed as { error?: unknown; result?: unknown };
  if (envelope.error != null) {
    throw new ZabbixFailure("rpc", rpcText(envelope.error));
  }
  if (!("result" in envelope)) {
    throw new ZabbixFailure("json", "Адрес API не отвечает JSON.");
  }
  if (response.status >= 400) {
    throw new ZabbixFailure("status", "Zabbix ответил отказом.");
  }
  return envelope.result;
}

export function zabbixFailureText(error: unknown): string {
  if (error instanceof ZabbixFailure) return error.message;
  return "Нет соединения с Zabbix.";
}
