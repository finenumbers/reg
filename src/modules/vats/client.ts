import {
  BOSS_DIALPLANS,
  BOSS_DOMAINS,
  BOSS_GATEWAYS,
  BOSS_ROUTES,
  BOSS_TELNUMS,
  bossRequestTarget,
  domainPath,
  domainSessionPath,
  domainStatPath,
  telnumPath,
} from "@/modules/vats/allowlist";
import { parseDomainName, parseLanguageValue, parseTelnum } from "@/modules/vats/names";
import { parseVatsOrigin } from "@/modules/vats/origin";

const MAX_BYTES = 20_000_000;
const TIMEOUT_MS = 30_000;

export type BossAuth = {
  origin: string;
  login: string;
  password: string;
};

export type BossDeps = {
  fetchImpl?: typeof fetch;
};

export type BossFailure = {
  ok: false;
  status: number;
  error: string;
  retry: boolean;
  truncated?: boolean;
};

export type BossSuccess<T> = {
  ok: true;
  status: number;
  data: T;
};

export type BossResult<T> = BossSuccess<T> | BossFailure;

export function bossStatusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Платформа не приняла запрос.";
    case 401:
      return "Данные для авторизации не приняты.";
    case 403:
      return "Платформа запретила запрос.";
    case 404:
      return "Хост или объект не найден.";
    case 409:
      return "Платформа сообщила о конфликте.";
    default:
      return `Платформа ответила кодом ${status}.`;
  }
}

function basicHeader(login: string, password: string): string | null {
  if (!login || !password) return null;
  if (/[\r\n\u0000]/.test(login) || /[\r\n\u0000]/.test(password)) return null;
  return `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;
}

function failure(
  status: number,
  error: string,
  retry: boolean,
  truncated = false,
): BossFailure {
  return { ok: false, status, error, retry, truncated };
}

async function readLimited(
  response: Response,
): Promise<{ text: string } | { truncated: true }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await response.body?.cancel();
    return { truncated: true };
  }
  const reader = response.body?.getReader();
  if (!reader) return { text: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return { truncated: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8") };
}

function endpoint(origin: string, method: "GET" | "PUT", path: string): string | null {
  const base = parseVatsOrigin(origin);
  if (!base || base !== origin) return null;
  if (bossRequestTarget(method, path) !== path) return null;
  let url: URL;
  try {
    url = new URL(path, `${origin}/`);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (bossRequestTarget(method, url.pathname) !== path) return null;
  return url.href;
}

async function once(
  auth: BossAuth,
  method: "GET" | "PUT",
  path: string,
  body: string | null,
  deps: BossDeps | undefined,
): Promise<BossResult<unknown>> {
  const href = endpoint(auth.origin, method, path);
  const authorization = basicHeader(auth.login, auth.password);
  if (!href || !authorization) {
    return failure(400, "Недопустимый адрес или учётные данные.", false);
  }
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(href, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        ...(body != null ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      ...(body != null ? { body } : {}),
    });
  } catch {
    return failure(0, "Платформа не ответила.", true);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return failure(response.status, "Платформа ответила переадресацией.", false);
  }
  if (method === "PUT") {
    await response.body?.cancel();
    if (response.status === 204) return { ok: true, status: 204, data: null };
    return failure(
      response.status,
      response.status === 400
        ? "Платформа не приняла запрос. Повторный запрос не отправлен."
        : `${bossStatusMessage(response.status)} Повторный запрос не отправлен.`,
      false,
    );
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return failure(
      response.status,
      bossStatusMessage(response.status),
      response.status >= 500,
    );
  }
  const read = await readLimited(response);
  if ("truncated" in read) {
    return failure(0, "Ответ обрезан. Сохранённый список не изменён.", false, true);
  }
  if (!read.text)
    return failure(response.status, "Платформа вернула пустой ответ.", false);
  try {
    return { ok: true, status: 200, data: JSON.parse(read.text) as unknown };
  } catch {
    return failure(response.status, "Платформа вернула не JSON.", false);
  }
}

async function readOnce(
  auth: BossAuth,
  path: string,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  const first = await once(auth, "GET", path, null, deps);
  if (first.ok || !first.retry) return first;
  return once(auth, "GET", path, null, deps);
}

export function domainPutBody(field: "client" | "language", value: string): string {
  if (field === "language" && parseLanguageValue(value) == null) {
    throw new Error("refused");
  }
  const body = field === "client" ? { client: value } : { language: value };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== field) throw new Error("refused");
  return JSON.stringify(body);
}

export function parseNameList(
  data: unknown,
  accept: (value: string) => string | null,
): string[] | null {
  if (!Array.isArray(data)) return null;
  const names: string[] = [];
  for (const item of data) {
    if (typeof item !== "string") return null;
    if (accept(item) !== item) return null;
    names.push(item);
  }
  return names;
}

export async function getDomains(
  auth: BossAuth,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  return readOnce(auth, BOSS_DOMAINS, deps);
}

export async function getDomain(
  auth: BossAuth,
  domain: string,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  const path = domainPath(domain);
  if (!path || parseDomainName(domain) !== domain) {
    return failure(400, "Недопустимое имя домена.", false);
  }
  return readOnce(auth, path, deps);
}

export async function getDomainStat(
  auth: BossAuth,
  domain: string,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  const path = domainStatPath(domain);
  if (!path || parseDomainName(domain) !== domain) {
    return failure(400, "Недопустимое имя домена.", false);
  }
  return readOnce(auth, path, deps);
}

/** One session link. This read is not retried, and a failure does not restart the walk. */
export async function getDomainSession(
  auth: BossAuth,
  domain: string,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  const path = domainSessionPath(domain);
  if (!path || parseDomainName(domain) !== domain) {
    return failure(400, "Недопустимое имя домена.", false);
  }
  return once(auth, "GET", path, null, deps);
}

export async function putDomainField(
  auth: BossAuth,
  domain: string,
  field: "client" | "language",
  value: string,
  deps?: BossDeps,
): Promise<BossResult<null>> {
  const path = domainPath(domain);
  if (!path) return failure(400, "Недопустимое имя домена.", false);
  let body: string;
  try {
    body = domainPutBody(field, value);
  } catch {
    return failure(400, "Недопустимое значение.", false);
  }
  const result = await once(auth, "PUT", path, body, deps);
  if (!result.ok) return result;
  return { ok: true, status: 204, data: null };
}

export async function getTelnums(
  auth: BossAuth,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  return readOnce(auth, BOSS_TELNUMS, deps);
}

export async function getTelnum(
  auth: BossAuth,
  telnum: string,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  const path = telnumPath(telnum);
  if (!path || parseTelnum(telnum) !== telnum) {
    return failure(400, "Недопустимый номер.", false);
  }
  return readOnce(auth, path, deps);
}

export async function getGateways(
  auth: BossAuth,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  return readOnce(auth, BOSS_GATEWAYS, deps);
}

export async function getRoutes(
  auth: BossAuth,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  return readOnce(auth, BOSS_ROUTES, deps);
}

export async function getDialplans(
  auth: BossAuth,
  deps?: BossDeps,
): Promise<BossResult<unknown>> {
  return readOnce(auth, BOSS_DIALPLANS, deps);
}
