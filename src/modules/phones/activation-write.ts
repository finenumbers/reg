import { buildActivationUpdateEnvelope } from "@/modules/rtu-soap/activation-envelope";
import type { ActivationUpdateCommand } from "@/modules/rtu-soap/activation-envelope";
import { rtuExchange, type RtuExchange } from "@/modules/rtu-soap/exchange";
import { quoteSoapAction } from "@/modules/rtu-soap/envelope";
import { interpretUpdateRowset } from "@/modules/rtu-soap/response";
import { redactSecret } from "@/modules/rtu-soap/xml";
import { readActivationWrite, readWsdl } from "@/modules/rtu-soap/wsdl";

const WSDL_TIMEOUT_MS = 10_000;
const UPDATE_TIMEOUT_MS = 60_000;

export type ActivationAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type ActivationExchange = (input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  caPem: string | null;
  fetchImpl?: typeof fetch;
}) => Promise<RtuExchange>;

export type ActivationWriteAttempt =
  | { sent: false; detail: string }
  | { sent: true; count: number | null; fault: string | null };

/**
 * One `updateRowset` for the active flag. A rejected binding sends nothing.
 * The caller does not retry.
 */
export async function sendActivationUpdate(input: {
  account: ActivationAccount;
  command: ActivationUpdateCommand;
  rowPassword: string;
  exchange?: ActivationExchange;
  fetchImpl?: typeof fetch;
}): Promise<ActivationWriteAttempt> {
  const exchange = input.exchange ?? rtuExchange;
  const secret = input.account.password;
  const wsdl = await exchange({
    url: `${input.account.origin}/service/?wsdl_v2`,
    method: "GET",
    headers: { Accept: "text/xml, application/xml" },
    timeoutMs: WSDL_TIMEOUT_MS,
    caPem: input.account.caPem,
    fetchImpl: input.fetchImpl,
  });
  if (!wsdl.ok)
    return { sent: false, detail: clean(wsdl.detail, secret, input.rowPassword) };
  if (wsdl.status < 200 || wsdl.status >= 300) {
    return { sent: false, detail: "WSDL не получен. Запись не отправлена." };
  }
  const objectsPlan = readWsdl(wsdl.text, input.account.origin);
  const writePlan = readActivationWrite(wsdl.text, input.account.origin);
  if (!objectsPlan.ok || !writePlan.ok || objectsPlan.endpoint !== writePlan.endpoint) {
    return {
      sent: false,
      detail: "Схема записи «Запись активна» в WSDL не разобрана. Запись не отправлена.",
    };
  }
  let envelope: string;
  try {
    envelope = buildActivationUpdateEnvelope(
      writePlan.binding,
      input.account.login,
      input.account.password,
      input.command,
    );
  } catch {
    return {
      sent: false,
      detail: "Запрос смены статуса не собран. Запись не отправлена.",
    };
  }
  const posted = await exchange({
    url: writePlan.endpoint,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: quoteSoapAction(writePlan.binding.soapAction),
    },
    body: envelope,
    timeoutMs: UPDATE_TIMEOUT_MS,
    caPem: input.account.caPem,
    fetchImpl: input.fetchImpl,
  });
  if (!posted.ok) {
    return {
      sent: true,
      count: null,
      fault: clean(posted.detail, secret, input.rowPassword),
    };
  }
  if (posted.status < 200 || posted.status >= 300) {
    return { sent: true, count: null, fault: "Коммутатор ответил ошибкой HTTP." };
  }
  const parsed = interpretUpdateRowset(posted.text, secret);
  if (parsed.kind === "fault") {
    return {
      sent: true,
      count: null,
      fault: clean(parsed.detail, secret, input.rowPassword),
    };
  }
  if (parsed.kind !== "count") return { sent: true, count: null, fault: null };
  return { sent: true, count: parsed.count, fault: null };
}

function clean(detail: string, accountPassword: string, rowPassword: string): string {
  const redacted = redactSecret(redactSecret(detail, accountPassword), rowPassword);
  return redacted.length > 200 ? `${redacted.slice(0, 200)}…` : redacted;
}
