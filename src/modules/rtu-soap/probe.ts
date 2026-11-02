import { parseRtuCaPem, tlsFailureDetail, classifyTlsCodes, collectErrorCodes } from "@/modules/rtu-soap/ca";
import { readCappedBody } from "@/modules/rtu-soap/body";
import { buildGetObjectsEnvelope, quoteSoapAction } from "@/modules/rtu-soap/envelope";
import { parseRtuSoapOrigin } from "@/modules/rtu-soap/origin";
import { interpretGetObjects, type RtuObject } from "@/modules/rtu-soap/response";
import { readWsdl } from "@/modules/rtu-soap/wsdl";
import { tlsRequest } from "@/modules/rtu-soap/tls-fetch";

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
  peerFingerprint: string | null;
  peerSubject: string | null;
};

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

type Loaded =
  | { ok: true; status: number; text: string }
  | { ok: false; report: RtuAccessReport };

export async function probeRtuSoapAccess(input: {
  origin: string;
  login: string;
  password: string;
  caPem?: string | null;
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
  const storedCa = input.caPem ?? "";
  let pinned: { pem: string; fingerprints: string[] } | null = null;
  if (storedCa.length > 0) {
    const parsed = parseRtuCaPem(storedCa);
    if (!parsed.ok) return report("tls", "Сохранённый сертификат не разбирается.");
    pinned = {
      pem: parsed.ca.pem,
      fingerprints: parsed.ca.certs.map((cert) => cert.fingerprint256),
    };
  }

  const load = async (
    url: string,
    method: "GET" | "POST",
    timeoutMs: number,
    headers: Record<string, string>,
    body?: string,
    tooLargeDetail?: string,
  ): Promise<Loaded> => {
    if (pinned) {
      const result = await tlsRequest({
        url,
        method,
        headers,
        body,
        caPem: pinned.pem,
        fingerprints: pinned.fingerprints,
        timeoutMs,
        maxBytes,
      });
      if (!result.ok) {
        const detail = result.code === "too_large" && tooLargeDetail ? tooLargeDetail : result.detail;
        return {
          ok: false,
          report: report(result.code, detail, result.peerFingerprint, result.peerSubject),
        };
      }
      return { ok: true, status: result.status, text: result.text };
    }
    try {
      const response = await fetchImpl(url, {
        method,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body,
      });
      if (response.status >= 300 && response.status < 400) {
        return { ok: true, status: response.status, text: "" };
      }
      const capped = await readCappedBody(response, maxBytes);
      if (!capped.ok) {
        return { ok: false, report: report("too_large", tooLargeDetail ?? "Ответ больше допустимого размера.") };
      }
      return { ok: true, status: response.status, text: capped.text };
    } catch (error) {
      return { ok: false, report: fromFetchError(error) };
    }
  };

  try {
    const wsdl = await load(
      `${origin}/service/?wsdl_v2`,
      "GET",
      input.wsdlTimeoutMs ?? 10_000,
      { Accept: "text/xml, application/xml" },
      undefined,
      "WSDL больше допустимого размера.",
    );
    if (!wsdl.ok) return wsdl.report;
    if (wsdl.status >= 300 && wsdl.status < 400) {
      return report("wsdl", "WSDL ответил редиректом. Пароль не отправлен.");
    }
    if (wsdl.status < 200 || wsdl.status >= 300) return report("wsdl", "WSDL не получен.");
    const plan = readWsdl(wsdl.text, origin);
    if (!plan.ok) {
      const detail =
        plan.reason === "host"
          ? "WSDL указывает другой адрес. Пароль не отправлен."
          : "Схема getObjects в WSDL не разобрана. Пароль не отправлен.";
      return report("wsdl", detail);
    }
    const envelope = buildGetObjectsEnvelope(plan.binding, input.login, input.password);
    const call = await load(
      plan.endpoint,
      "POST",
      input.callTimeoutMs ?? 20_000,
      {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: quoteSoapAction(plan.binding.soapAction),
      },
      envelope,
      "Ответ больше допустимого размера.",
    );
    if (!call.ok) return call.report;
    if (call.status >= 300 && call.status < 400) {
      return report("wsdl", "Сервис ответил редиректом.");
    }
    const parsed = interpretGetObjects(call.text, input.password);
    if (parsed.kind === "fault") {
      return report("fault", parsed.detail || "Коммутатор вернул отказ.");
    }
    if (parsed.kind === "bad") return report("wsdl", "Ответ getObjects не разобран.");
    if (call.status < 200 || call.status >= 300) {
      return report("network", "Коммутатор ответил ошибкой HTTP.");
    }
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
    peerFingerprint: null,
    peerSubject: null,
  };
}

function fromFetchError(error: unknown): RtuAccessReport {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return report("timeout", "Коммутатор не ответил вовремя.");
  }
  const kind = classifyTlsCodes(collectErrorCodes(error));
  if (kind) return report("tls", tlsFailureDetail(kind));
  return report("network", "Нет соединения с коммутатором.");
}

function report(
  code: RtuAccessCode,
  detail: string,
  peerFingerprint: string | null = null,
  peerSubject: string | null = null,
): RtuAccessReport {
  return {
    code,
    detail,
    tableCount: 0,
    procedureCount: 0,
    procedures: [],
    proceduresOmitted: 0,
    peerFingerprint,
    peerSubject,
  };
}
