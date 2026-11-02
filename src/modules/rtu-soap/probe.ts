import { readCappedBody } from "@/modules/rtu-soap/body";
import { buildGetObjectsEnvelope, quoteSoapAction } from "@/modules/rtu-soap/envelope";
import { parseRtuSoapOrigin } from "@/modules/rtu-soap/origin";
import { interpretGetObjects, type RtuObject } from "@/modules/rtu-soap/response";
import { readWsdl } from "@/modules/rtu-soap/wsdl";

export type RtuAccessCode =
  | "ok"
  | "tls"
  | "timeout"
  | "wsdl"
  | "fault"
  | "too_large"
  | "network";

export type RtuProcedurePreview = {
  objectId: string;
  title: string;
  path: string;
};

export type RtuAccessReport = {
  code: RtuAccessCode;
  detail: string;
  tableCount: number;
  procedureCount: number;
  procedures: RtuProcedurePreview[];
  proceduresOmitted: number;
};

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export async function probeRtuSoapAccess(input: {
  origin: string;
  login: string;
  password: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  previewLimit?: number;
  wsdlTimeoutMs?: number;
  callTimeoutMs?: number;
}): Promise<RtuAccessReport> {
  const origin = parseRtuSoapOrigin(input.origin);
  if (!origin || input.login.trim().length === 0 || input.password.length === 0) {
    return report("wsdl", "Не заданы URL, логин или пароль.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const previewLimit = input.previewLimit ?? 100;
  try {
    const wsdl = await fetchImpl(`${origin}/service/?wsdl_v2`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(input.wsdlTimeoutMs ?? 10_000),
      headers: { Accept: "text/xml, application/xml" },
    });
    if (wsdl.status >= 300 && wsdl.status < 400) {
      return report("wsdl", "WSDL ответил редиректом. Пароль не отправлен.");
    }
    if (!wsdl.ok) return report("wsdl", "WSDL не получен.");
    const wsdlBody = await readCappedBody(wsdl, maxBytes);
    if (!wsdlBody.ok) return report("too_large", "WSDL больше допустимого размера.");
    const plan = readWsdl(wsdlBody.text, origin);
    if (!plan.ok) {
      const detail =
        plan.reason === "host"
          ? "WSDL указывает другой адрес. Пароль не отправлен."
          : "Схема getObjects в WSDL не разобрана. Пароль не отправлен.";
      return report("wsdl", detail);
    }
    const envelope = buildGetObjectsEnvelope(plan.binding, input.login, input.password);
    const call = await fetchImpl(plan.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(input.callTimeoutMs ?? 20_000),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: quoteSoapAction(plan.binding.soapAction),
      },
      body: envelope,
    });
    if (call.status >= 300 && call.status < 400) {
      return report("wsdl", "Сервис ответил редиректом.");
    }
    const callBody = await readCappedBody(call, maxBytes);
    if (!callBody.ok) return report("too_large", "Ответ больше допустимого размера.");
    const parsed = interpretGetObjects(callBody.text, input.password);
    if (parsed.kind === "fault") {
      return report("fault", parsed.detail || "Коммутатор вернул отказ.");
    }
    if (parsed.kind === "bad") return report("wsdl", "Ответ getObjects не разобран.");
    if (!call.ok) return report("network", "Коммутатор ответил ошибкой HTTP.");
    return summarize(parsed.objects, previewLimit);
  } catch (error) {
    return fromFetchError(error);
  }
}

function summarize(objects: RtuObject[], previewLimit: number): RtuAccessReport {
  const tables = objects.filter((item) => item.type === "table");
  const procedures = objects.filter((item) => item.type === "procedure");
  const shown = procedures.slice(0, previewLimit);
  return {
    code: "ok",
    detail: `Доступ есть: таблиц ${tables.length}, процедур ${procedures.length}. Контекстные процедуры и маски записи не читались.`,
    tableCount: tables.length,
    procedureCount: procedures.length,
    procedures: shown.map((item) => ({
      objectId: item.objectId,
      title: item.title,
      path: item.path,
    })),
    proceduresOmitted: Math.max(0, procedures.length - shown.length),
  };
}

function fromFetchError(error: unknown): RtuAccessReport {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return report("timeout", "Коммутатор не ответил вовремя.");
  }
  const code = causeCode(error);
  if (/CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|ERR_TLS/i.test(code)) {
    return report(
      "tls",
      "Сертификат HTTPS не принят. Частный CA задаётся через NODE_EXTRA_CA_CERTS.",
    );
  }
  return report("network", "Нет соединения с коммутатором.");
}

function causeCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("cause" in error)) return "";
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : "";
}

function report(code: RtuAccessCode, detail: string): RtuAccessReport {
  return {
    code,
    detail,
    tableCount: 0,
    procedureCount: 0,
    procedures: [],
    proceduresOmitted: 0,
  };
}
