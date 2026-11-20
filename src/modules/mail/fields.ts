/**
 * Syntax checks for the outbound mail card. No network and no Node-only APIs,
 * so the settings form can share them.
 */

const MAILBOX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export type MailView = {
  host: string;
  port: 465 | 587 | null;
  username: string;
  from: string;
  recipients: string[];
  hasPassword: boolean;
};

export const MAIL_RECIPIENT_LIMIT = 20;
export const MAIL_PASSWORD_LIMIT = 4096;
export const MAIL_TEXT_LIMIT = 320;

export const MAIL_PHRASE = {
  timeout: "Почтовый сервер не ответил.",
  cert: "Сертификат почтового сервера не принят.",
  auth: "Почтовый сервер не принял логин.",
  refused: "Почтовый сервер не принял письмо.",
  busy: "Уже выполняется.",
  incomplete: "Сначала сохраните настройки почты.",
  interrupted: "Проверка прервана.",
  name: "Имя почтового сервера не принято.",
  limited: "Слишком много проверок. Подождите.",
  sent: "Письмо отправлено.",
  saved: "Настройки сохранены.",
  body: "Проверка не принимает данные.",
  large: "Слишком большой запрос.",
  host: "Сервер не принят.",
  port: "Укажите порт отправки.",
  username: "Логин не принят.",
  password: "Пароль не принят.",
  passwordMissing: "Укажите пароль.",
  from: "Адрес отправителя не принят.",
  recipient: "Адрес получателя не принят.",
  recipientRepeat: "В списке повторяется адрес.",
  recipientMany: "Адресов больше двадцати.",
  recipientEmpty: "Укажите хотя бы один адрес получателя.",
  shape: "Укажите сервер, порт, отправителя и адреса.",
} as const;

export const PROBE_SUBJECT = "Проверка исходящей почты";

export function probeText(now: Date): string {
  return `Проверка исходящей почты. ${now.toISOString()}`;
}

export function localMailName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local");
}

export function isSmtpIPv4(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  return value.split(".").every((part) => {
    if (part.length > 1 && part.startsWith("0")) return false;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export type ParsedHost = { ok: true; host: string; literal: boolean } | { ok: false };

/** Shape only. Address policy for an IPv4 literal is applied by the caller. */
export function parseMailHost(raw: string): ParsedHost {
  const host = raw.trim();
  if (!host || host.length > 253 || /[\u0000-\u001f\u007f]/.test(host))
    return { ok: false };
  if (/[/:@\\?#\s[\]]/.test(host) || host.includes("..")) return { ok: false };
  if (localMailName(host)) return { ok: false };
  if (isSmtpIPv4(host)) return { ok: true, host, literal: true };
  if (!HOSTNAME.test(host)) return { ok: false };
  return { ok: true, host: host.toLowerCase(), literal: false };
}

export function parseMailPort(value: unknown): 465 | 587 | null {
  if (value === 465 || value === 587) return value;
  return null;
}

export function parseMailbox(raw: string): string | null {
  const mailbox = raw.trim();
  if (!mailbox || mailbox.length > MAIL_TEXT_LIMIT || mailbox.includes("..")) return null;
  if (/[\u0000-\u001f\u007f]/.test(mailbox) || /[^\x21-\x7e]/.test(mailbox)) return null;
  if (!MAILBOX.test(mailbox)) return null;
  return mailbox;
}

export function parseMailUsername(
  raw: string,
): { ok: true; username: string | null } | { ok: false } {
  const username = raw.trim();
  if (!username) return { ok: true, username: null };
  if (username.length > MAIL_TEXT_LIMIT || /[\u0000-\u001f\u007f]/.test(username))
    return { ok: false };
  if (/[^\x21-\x7e]/.test(username)) return { ok: false };
  return { ok: true, username };
}

export function parseMailPassword(
  raw: string,
): { ok: true; password: string | null } | { ok: false } {
  if (raw.length === 0) return { ok: true, password: null };
  if (raw.length > MAIL_PASSWORD_LIMIT || /[\u0000\r\n]/.test(raw)) return { ok: false };
  return { ok: true, password: raw };
}

export function parseRecipientList(
  values: string[],
): { ok: true; recipients: string[] } | { ok: false; error: string } {
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const mailbox = parseMailbox(value);
    if (!mailbox) return { ok: false, error: MAIL_PHRASE.recipient };
    const key = mailbox.toLowerCase();
    if (seen.has(key)) return { ok: false, error: MAIL_PHRASE.recipientRepeat };
    seen.add(key);
    recipients.push(mailbox);
  }
  if (recipients.length > MAIL_RECIPIENT_LIMIT) {
    return { ok: false, error: MAIL_PHRASE.recipientMany };
  }
  return { ok: true, recipients };
}

export function parseRecipientText(
  text: string,
): { ok: true; recipients: string[] } | { ok: false; error: string } {
  const values = text
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parseRecipientList(values);
}
