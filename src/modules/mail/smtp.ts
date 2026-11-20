/**
 * One SMTP delivery. The host argument is the address already chosen.
 * AUTH runs only after TLS. The message text is the fixed probe.
 */

import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { MAIL_PHRASE, PROBE_SUBJECT, probeText } from "@/modules/mail/fields";

export type ProbeCode =
  | "success"
  | "timeout"
  | "cert"
  | "auth"
  | "refused"
  | "interrupted"
  | "name"
  | "deadline";

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_SIGNATURE_FAILURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_NOT_YET_VALID",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNECTION",
  "ESOCKET",
  "EDNS",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEOUT",
  "ETLS",
]);

export type SmtpOptions = SMTPTransport.Options & {
  disableFileAccess: true;
  disableUrlAccess: true;
};

export type ProbeMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  messageId: string;
  envelope: { from: string; to: string[] };
  disableFileAccess: true;
  disableUrlAccess: true;
};

type MailTransport = {
  sendMail(
    message: ProbeMessage,
  ): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
};

function codesOf(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown; responseCode?: unknown };
    if (typeof record.code === "string") codes.push(record.code);
    if (typeof record.responseCode === "number") codes.push(String(record.responseCode));
    current = record.cause;
  }
  return codes;
}

export function classifySmtpError(
  error: unknown,
): Exclude<ProbeCode, "success" | "interrupted" | "name" | "deadline"> {
  const codes = codesOf(error);
  if (codes.some((code) => TLS_CODES.has(code))) return "cert";
  if (
    codes.some(
      (code) => code === "EAUTH" || code === "535" || code === "534" || code === "530",
    )
  ) {
    return "auth";
  }
  if (
    codes.some(
      (code) =>
        code === "EENVELOPE" ||
        code === "EMESSAGE" ||
        (code.length === 3 && (code.startsWith("4") || code.startsWith("5"))),
    )
  ) {
    return "refused";
  }
  if (codes.some((code) => TIMEOUT_CODES.has(code))) return "timeout";
  return "timeout";
}

export function probePhrase(code: ProbeCode | "busy" | "incomplete" | "limited"): string {
  if (code === "success") return MAIL_PHRASE.sent;
  if (code === "cert") return MAIL_PHRASE.cert;
  if (code === "auth") return MAIL_PHRASE.auth;
  if (code === "refused") return MAIL_PHRASE.refused;
  if (code === "interrupted") return MAIL_PHRASE.interrupted;
  if (code === "name") return MAIL_PHRASE.name;
  if (code === "busy") return MAIL_PHRASE.busy;
  if (code === "incomplete") return MAIL_PHRASE.incomplete;
  if (code === "limited") return MAIL_PHRASE.limited;
  return MAIL_PHRASE.timeout;
}

export function buildSmtpOptions(input: {
  hostName: string;
  address: string;
  port: 465 | 587;
  username: string | null;
  password: string | null;
}): SmtpOptions {
  const secure = input.port === 465;
  const options: SmtpOptions = {
    host: input.address,
    port: input.port,
    secure,
    requireTLS: true,
    ignoreTLS: false,
    opportunisticTLS: false,
    name: "reg",
    servername: input.hostName,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000,
    dnsTimeout: 5_000,
    logger: false,
    debug: false,
    transactionLog: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: input.hostName,
    },
  };
  if (input.username && input.password) {
    options.auth = { type: "login", user: input.username, pass: input.password };
  }
  return options;
}

function messageId(from: string, now: Date): string {
  const domain = from.slice(from.lastIndexOf("@") + 1);
  const nonce = randomBytes(16).toString("hex");
  return `<${now.getTime().toString(16)}.${nonce}@${domain}>`;
}

function acceptedAll(
  info: { accepted?: unknown[]; rejected?: unknown[] },
  recipients: string[],
): boolean {
  if ((info.rejected ?? []).length > 0) return false;
  const accepted = new Set(
    (info.accepted ?? []).map((item) => String(item).trim().toLowerCase()),
  );
  return recipients.every((recipient) => accepted.has(recipient.toLowerCase()));
}

export async function deliverProbe(
  input: {
    hostName: string;
    address: string;
    port: 465 | 587;
    username: string | null;
    password: string | null;
    from: string;
    recipients: string[];
    signal: AbortSignal;
    now: Date;
  },
  factory: (options: SmtpOptions) => MailTransport = (options) =>
    nodemailer.createTransport(options),
): Promise<{ ok: true } | { ok: false; code: ProbeCode }> {
  if (input.signal.aborted) {
    return {
      ok: false,
      code: input.signal.reason === "request" ? "interrupted" : "deadline",
    };
  }
  const transport = factory(
    buildSmtpOptions({
      hostName: input.hostName,
      address: input.address,
      port: input.port,
      username: input.username,
      password: input.password,
    }),
  );
  const onAbort = () => transport.close();
  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const info = await transport.sendMail({
      from: input.from,
      to: input.recipients,
      subject: PROBE_SUBJECT,
      text: probeText(input.now),
      messageId: messageId(input.from, input.now),
      envelope: { from: input.from, to: input.recipients },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (input.signal.aborted) {
      return {
        ok: false,
        code: input.signal.reason === "request" ? "interrupted" : "deadline",
      };
    }
    return acceptedAll(info, input.recipients)
      ? { ok: true }
      : { ok: false, code: "refused" };
  } catch (error) {
    if (input.signal.aborted) {
      return {
        ok: false,
        code: input.signal.reason === "request" ? "interrupted" : "deadline",
      };
    }
    const code = classifySmtpError(error);
    return { ok: false, code };
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    transport.close();
  }
}
