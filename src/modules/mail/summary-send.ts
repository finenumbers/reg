/**
 * Send the numbering summary after the group chain has released its slot.
 * The letter is already built. SMTP waits for the one mail slot.
 */

import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { resolveMailHost } from "@/modules/mail/dns";
import { tryHoldMailSend } from "@/modules/mail/hold";
import { readyProbe } from "@/modules/mail/plan";
import { deliverProbe } from "@/modules/mail/smtp";
import { decryptMailPassword, readMailRow } from "@/modules/mail/store";
import { composeNumberingSummary } from "@/modules/mail/summary-data";
import { renderSummary } from "@/modules/mail/summary-letter";
import type { ProviderMarks } from "@/modules/mail/summary-marks";
import { getDisplayTimezone } from "@/modules/settings";

const DEADLINE_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function holdWhenFree(): Promise<() => void> {
  for (;;) {
    const release = tryHoldMailSend();
    if (release) return release;
    await sleep(200);
  }
}

export async function deliverNumberingSummary(input: {
  marks: ProviderMarks[];
  startedAt: Date;
  scheduled: boolean;
}): Promise<void> {
  const started = Date.now();
  let problemTotal = 0;
  try {
    const timeZone = await getDisplayTimezone();
    const composed = await composeNumberingSummary({ ...input, timeZone });
    problemTotal = composed.problemTotal;
    const letter = renderSummary(composed);
    const ready = readyProbe(await readMailRow());
    if (!ready) {
      logger.info("mail.summary", {
        result: "incomplete",
        durationMs: Date.now() - started,
      });
      await audit("incomplete", Date.now() - started, problemTotal);
      return;
    }
    const release = await holdWhenFree();
    const stop = new AbortController();
    const timer = setTimeout(() => {
      if (!stop.signal.aborted) stop.abort("deadline");
    }, DEADLINE_MS);
    try {
      let password: string | null = null;
      if (ready.passwordCiphertext)
        password = decryptMailPassword(ready.passwordCiphertext);
      const resolved = await resolveMailHost(ready.host, ready.literal, stop.signal);
      if (!resolved.ok) {
        const result =
          resolved.code === "request"
            ? "interrupted"
            : resolved.code === "deadline"
              ? "timeout"
              : resolved.code;
        logger.info("mail.summary", { result, durationMs: Date.now() - started });
        await audit(result, Date.now() - started, problemTotal);
        return;
      }
      const sent = await deliverProbe({
        hostName: ready.host,
        address: resolved.address,
        port: ready.port,
        username: ready.username,
        password,
        from: ready.from,
        recipients: ready.recipients,
        signal: stop.signal,
        now: new Date(),
        subject: letter.subject,
        text: letter.text,
        html: letter.html,
      });
      const result = sent.ok
        ? "success"
        : sent.code === "deadline"
          ? "timeout"
          : sent.code;
      logger.info("mail.summary", { result, durationMs: Date.now() - started });
      await audit(result, Date.now() - started, problemTotal);
    } finally {
      clearTimeout(timer);
      stop.abort("deadline");
      release();
    }
  } catch {
    logger.info("mail.summary", { result: "timeout", durationMs: Date.now() - started });
    await audit("timeout", Date.now() - started, problemTotal);
  }
}

async function audit(result: string, durationMs: number, problemTotal: number): Promise<void> {
  await auditService.append({
    action: AUDIT_ACTIONS.MAIL_SUMMARY,
    entityType: "app_settings",
    entityId: "1",
    meta: { result, durationMs, problemTotal },
  });
}
