/**
 * What a mail save is allowed to write. No database and no SMTP.
 */

import { isMailAddressAllowed } from "@/modules/mail/addresses";
import {
  MAIL_PHRASE,
  parseMailHost,
  parseMailPassword,
  parseMailPort,
  parseMailbox,
  parseMailUsername,
  parseRecipientList,
  type MailView,
} from "@/modules/mail/fields";

export type MailRow = {
  host: string | null;
  port: number | null;
  username: string | null;
  from: string | null;
  recipients: unknown;
  passwordCiphertext: string | null;
};

export type MailSaveInput = {
  host: unknown;
  port: unknown;
  username: unknown;
  password: unknown;
  from: unknown;
  recipients: unknown;
};

export type MailSaveDecision =
  | { ok: false; error: string }
  | { ok: true; mode: "clear" }
  | {
      ok: true;
      mode: "set";
      host: string;
      literal: boolean;
      port: 465 | 587;
      username: string | null;
      from: string;
      recipients: string[];
      password: string | null;
    };

export type ReadyProbe = {
  host: string;
  literal: boolean;
  port: 465 | 587;
  username: string | null;
  from: string;
  recipients: string[];
  passwordCiphertext: string | null;
};

function storedRecipients(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const recipients: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const mailbox = parseMailbox(item);
    if (!mailbox || mailbox !== item) return null;
    recipients.push(mailbox);
  }
  const parsed = parseRecipientList(recipients);
  if (!parsed.ok || parsed.recipients.length !== recipients.length) return null;
  return parsed.recipients;
}

export function mailView(row: MailRow | null): MailView {
  const empty: MailView = {
    host: "",
    port: null,
    username: "",
    from: "",
    recipients: [],
    hasPassword: Boolean(row?.passwordCiphertext),
  };
  if (!row) return empty;
  const host = row.host ? parseMailHost(row.host) : { ok: false as const };
  const recipients = storedRecipients(row.recipients);
  const from = row.from ? parseMailbox(row.from) : null;
  const port = parseMailPort(row.port);
  return {
    host: host.ok && (!host.literal || isMailAddressAllowed(host.host)) ? host.host : "",
    port,
    username: row.username?.trim() ?? "",
    from: from ?? "",
    recipients: recipients ?? [],
    hasPassword: Boolean(row.passwordCiphertext),
  };
}

export function planMailSave(
  input: MailSaveInput,
  hasPassword: boolean,
): MailSaveDecision {
  if (typeof input.host !== "string") return { ok: false, error: MAIL_PHRASE.shape };
  if (input.host.trim().length === 0) return { ok: true, mode: "clear" };
  if (typeof input.username !== "string" || typeof input.password !== "string") {
    return { ok: false, error: MAIL_PHRASE.shape };
  }
  if (typeof input.from !== "string" || !Array.isArray(input.recipients)) {
    return { ok: false, error: MAIL_PHRASE.shape };
  }
  if (!input.recipients.every((item) => typeof item === "string")) {
    return { ok: false, error: MAIL_PHRASE.recipient };
  }

  const host = parseMailHost(input.host);
  if (!host.ok || (host.literal && !isMailAddressAllowed(host.host))) {
    return { ok: false, error: MAIL_PHRASE.host };
  }
  const port = parseMailPort(input.port);
  if (!port) return { ok: false, error: MAIL_PHRASE.port };
  const username = parseMailUsername(input.username);
  if (!username.ok) return { ok: false, error: MAIL_PHRASE.username };
  const password = parseMailPassword(input.password);
  if (!password.ok) return { ok: false, error: MAIL_PHRASE.password };
  const from = parseMailbox(input.from);
  if (!from) return { ok: false, error: MAIL_PHRASE.from };
  const recipients = parseRecipientList(input.recipients);
  if (!recipients.ok) return recipients;
  if (recipients.recipients.length === 0) {
    return { ok: false, error: MAIL_PHRASE.recipientEmpty };
  }
  if (username.username && !password.password && !hasPassword) {
    return { ok: false, error: MAIL_PHRASE.passwordMissing };
  }

  return {
    ok: true,
    mode: "set",
    host: host.host,
    literal: host.literal,
    port,
    username: username.username,
    from,
    recipients: recipients.recipients,
    password: password.password,
  };
}

/** Re-reads the stored row. A bad value does not open a connection. */
export function readyProbe(row: MailRow | null): ReadyProbe | null {
  if (!row?.host || !row.from) return null;
  const host = parseMailHost(row.host);
  if (!host.ok || host.host !== row.host) return null;
  if (host.literal && !isMailAddressAllowed(host.host)) return null;
  const port = parseMailPort(row.port);
  if (!port) return null;
  const from = parseMailbox(row.from);
  if (!from || from !== row.from) return null;
  const recipients = storedRecipients(row.recipients);
  if (!recipients || recipients.length === 0) return null;
  const username = row.username?.trim() ? row.username.trim() : null;
  if (username && username !== row.username) return null;
  if (username && !row.passwordCiphertext) return null;
  if (!username && row.username) return null;
  return {
    host: host.host,
    literal: host.literal,
    port,
    username,
    from,
    recipients,
    passwordCiphertext: username ? row.passwordCiphertext : null,
  };
}
