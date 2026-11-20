/**
 * One DNS lookup before SMTP. The socket then uses the chosen address only.
 */

import { resolve4, resolve6 } from "node:dns/promises";
import { chooseMailAddress, isMailAddressAllowed } from "@/modules/mail/addresses";

export class MailStopped extends Error {
  constructor(readonly kind: "request" | "deadline") {
    super(kind);
    this.name = "MailStopped";
  }
}

export type MailLookup = {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
};

const DNS_MS = 5_000;

function dnsCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function missingDns(error: unknown): boolean {
  const code = dnsCode(error);
  return code === "ENOTFOUND" || code === "ENODATA" || code === "ENOENT";
}

function withBound<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("dns-timeout"), { code: "ETIMEOUT" })),
      DNS_MS,
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MailStopped(signal.reason === "request" ? "request" : "deadline"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function oneFamily(
  work: Promise<string[]>,
  signal: AbortSignal,
): Promise<{ records: string[] } | { error: "timeout" | "missing" }> {
  try {
    const records = await withBound(work, signal);
    return { records };
  } catch (error) {
    if (error instanceof MailStopped) throw error;
    if (missingDns(error)) return { error: "missing" };
    return { error: "timeout" };
  }
}

export async function resolveMailHost(
  host: string,
  literal: boolean,
  signal: AbortSignal,
  lookup: MailLookup = { resolve4, resolve6 },
): Promise<
  | { ok: true; address: string; family: 4 | 6 }
  | { ok: false; code: "timeout" | "name" | "request" | "deadline" }
> {
  if (signal.aborted) {
    return { ok: false, code: signal.reason === "request" ? "request" : "deadline" };
  }
  if (literal) {
    return isMailAddressAllowed(host)
      ? { ok: true, address: host, family: 4 }
      : { ok: false, code: "name" };
  }
  try {
    const [v4, v6] = await Promise.all([
      oneFamily(lookup.resolve4(host), signal),
      oneFamily(lookup.resolve6(host), signal),
    ]);
    if ("error" in v4 && v4.error === "timeout") return { ok: false, code: "timeout" };
    if ("error" in v6 && v6.error === "timeout") return { ok: false, code: "timeout" };
    const chosen = chooseMailAddress(
      "records" in v4 ? v4.records : [],
      "records" in v6 ? v6.records : [],
    );
    return chosen.ok ? chosen : { ok: false, code: "name" };
  } catch (error) {
    if (error instanceof MailStopped) return { ok: false, code: error.kind };
    return { ok: false, code: "timeout" };
  }
}
