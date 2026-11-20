/**
 * One saved-settings probe. The database connection is not held while SMTP runs.
 */

import { logger } from "@/lib/logger";
import { mailProbeRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { resolveMailHost } from "@/modules/mail/dns";
import { tryHoldMailSend } from "@/modules/mail/hold";
import { readyProbe, type MailRow } from "@/modules/mail/plan";
import { deliverProbe, probePhrase, type ProbeCode } from "@/modules/mail/smtp";
import { decryptMailPassword, readMailRow } from "@/modules/mail/store";

const DEADLINE_MS = 20_000;

export type ProbeResultCode =
  Exclude<ProbeCode, "deadline"> | "busy" | "incomplete" | "limited";

export type ProbeOutcome = {
  status: number;
  result: ProbeResultCode;
  error?: string;
  detail?: string;
  retryAfterSec?: number;
};

type ProbeDeps = {
  read: () => Promise<MailRow | null>;
  decrypt: (ciphertext: string) => string;
  resolve: typeof resolveMailHost;
  deliver: typeof deliverProbe;
  hold: typeof tryHoldMailSend;
  limit: {
    check: (key: string) => { allowed: boolean; retryAfterSec: number };
  };
  now: () => number;
  audit: (meta: Record<string, unknown>) => Promise<void>;
  log: (fields: Record<string, unknown>) => void;
};

function stopFor(request: AbortSignal | undefined): {
  signal: AbortSignal;
  close: () => void;
} {
  const stop = new AbortController();
  const timer = setTimeout(() => {
    if (!stop.signal.aborted) stop.abort("deadline");
  }, DEADLINE_MS);
  const onRequest = () => {
    if (!stop.signal.aborted) stop.abort("request");
  };
  if (request?.aborted) onRequest();
  else request?.addEventListener("abort", onRequest, { once: true });
  return {
    signal: stop.signal,
    close: () => {
      clearTimeout(timer);
      request?.removeEventListener("abort", onRequest);
    },
  };
}

export async function runMailProbe(
  actor: { userId: string; ip?: string | null },
  request: AbortSignal | undefined,
  deps: ProbeDeps,
): Promise<ProbeOutcome> {
  const started = deps.now();
  if (request?.aborted) {
    return { status: 502, result: "interrupted", error: probePhrase("interrupted") };
  }
  const release = deps.hold();
  if (!release) {
    return { status: 409, result: "busy", error: probePhrase("busy") };
  }

  let outcome: ProbeOutcome = {
    status: 502,
    result: "timeout",
    error: probePhrase("timeout"),
  };
  let audited = false;
  const finish = (next: ProbeOutcome, row: MailRow | null): ProbeOutcome => {
    outcome = next;
    if (!audited) {
      audited = true;
      const viewHost = typeof row?.host === "string" ? row.host : "";
      const recipients = Array.isArray(row?.recipients)
        ? row.recipients
            .filter((item): item is string => typeof item === "string")
            .slice(0, 20)
        : [];
      void Promise.resolve(
        deps.audit({
          host: viewHost || null,
          port: row?.port ?? null,
          from: typeof row?.from === "string" ? row.from : null,
          recipients,
          result: next.result,
          durationMs: Math.max(0, deps.now() - started),
        }),
      ).catch(() => undefined);
      deps.log({
        result: next.result,
        host: viewHost,
        durationMs: Math.max(0, deps.now() - started),
      });
    }
    return outcome;
  };

  let row: MailRow | null = null;
  try {
    row = await deps.read();
    const ready = readyProbe(row);
    if (!ready)
      return finish(
        { status: 400, result: "incomplete", error: probePhrase("incomplete") },
        row,
      );

    const limited = deps.limit.check(`mail-probe:${actor.userId}`);
    if (!limited.allowed) {
      return finish(
        {
          status: 429,
          result: "limited",
          error: probePhrase("limited"),
          retryAfterSec: limited.retryAfterSec,
        },
        row,
      );
    }
    if (request?.aborted) {
      return finish(
        { status: 502, result: "interrupted", error: probePhrase("interrupted") },
        row,
      );
    }

    const stop = stopFor(request);
    try {
      const resolved = await deps.resolve(ready.host, ready.literal, stop.signal);
      if (!resolved.ok) {
        const code =
          resolved.code === "deadline"
            ? "timeout"
            : resolved.code === "request"
              ? "interrupted"
              : resolved.code;
        return finish({ status: 502, result: code, error: probePhrase(code) }, row);
      }

      let password: string | null = null;
      if (ready.passwordCiphertext) {
        try {
          password = deps.decrypt(ready.passwordCiphertext);
        } catch {
          return finish(
            { status: 400, result: "incomplete", error: probePhrase("incomplete") },
            row,
          );
        }
      }

      const sent = await deps.deliver({
        hostName: ready.host,
        address: resolved.address,
        port: ready.port,
        username: ready.username,
        password,
        from: ready.from,
        recipients: ready.recipients,
        signal: stop.signal,
        now: new Date(deps.now()),
      });
      if (sent.ok) {
        return finish(
          { status: 200, result: "success", detail: probePhrase("success") },
          row,
        );
      }
      const code = sent.code === "deadline" ? "timeout" : sent.code;
      return finish({ status: 502, result: code, error: probePhrase(code) }, row);
    } finally {
      stop.close();
    }
  } catch {
    return finish(outcome, row);
  } finally {
    release();
  }
}

export function sendSavedProbe(
  actor: { userId: string; ip?: string | null },
  request?: AbortSignal,
): Promise<ProbeOutcome> {
  return runMailProbe(actor, request, {
    read: readMailRow,
    decrypt: decryptMailPassword,
    resolve: resolveMailHost,
    deliver: deliverProbe,
    hold: tryHoldMailSend,
    limit: mailProbeRateLimiter,
    now: Date.now,
    audit: async (meta) => {
      await auditService.append({
        actorUserId: actor.userId,
        action: AUDIT_ACTIONS.MAIL_TEST,
        entityType: "app_settings",
        entityId: "1",
        ip: actor.ip,
        meta,
      });
    },
    log: (fields) => logger.info("mail.probe", fields),
  });
}
