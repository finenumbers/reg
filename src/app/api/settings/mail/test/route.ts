import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { MAIL_PHRASE } from "@/modules/mail/fields";
import { readCappedBody } from "@/modules/mail/body";
import { sendSavedProbe } from "@/modules/mail/probe";

export const maxDuration = 30;

/**
 * POST /api/settings/mail/test — one fixed letter to the saved addresses.
 * The body is empty. The password is the one already stored.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const body = await readCappedBody(request, 0);
  if (!body.ok || body.text.length > 0) {
    return NextResponse.json(
      { error: MAIL_PHRASE.body, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const ip = await getRequestIp();
  const probe = await sendSavedProbe({ userId, ip }, request.signal);
  if (probe.status === 200) {
    return NextResponse.json({
      test: { result: probe.result, detail: probe.detail },
    });
  }
  return NextResponse.json(
    { error: probe.error, code: probe.result },
    {
      status: probe.status,
      headers: probe.retryAfterSec
        ? { "Retry-After": String(probe.retryAfterSec) }
        : undefined,
    },
  );
}
