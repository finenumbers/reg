import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { bdpnLookupRateLimiter } from "@/lib/rate-limit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { lookupBdpnNumber } from "@/modules/bdpn/client";
import { BdpnLookupError } from "@/modules/bdpn/parse";
import { acquireBdpnLookup, releaseBdpnLookup } from "@/modules/bdpn/flight";
import { bdpnNumberFromBillDnis } from "@/modules/oprs/bdpn-number";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function json(
  body: unknown,
  status: number,
  extra?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/**
 * POST /api/oprs/bdpn — one public BDPN check of an OPRS B-number.
 * Session only. The number is 79 and nine digits. The leading 7 is removed here.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return json({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некорректное тело запроса", code: "BAD_REQUEST" }, 400);
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = record.number;
  if (typeof raw !== "string" || raw.length > 16) {
    return json({ error: "Некорректный номер", code: "BAD_REQUEST" }, 400);
  }
  const number = bdpnNumberFromBillDnis(raw);
  if (!number) {
    return json({ error: "Номер БДПН: 79 и ещё 9 цифр.", code: "INVALID" }, 400);
  }

  const slot = acquireBdpnLookup(userId);
  if (slot !== "ok") {
    return json(
      {
        error:
          slot === "user"
            ? "Проверка этого номера уже выполняется."
            : "Слишком много проверок — повторите через несколько секунд.",
        code: "RATE_LIMITED",
      },
      429,
      { "Retry-After": "1" },
    );
  }

  try {
    const limited = bdpnLookupRateLimiter.check(`bdpn:${userId}`);
    if (!limited.allowed) {
      return json(
        {
          error: "Слишком много проверок БДПН — повторите позже.",
          code: "RATE_LIMITED",
          retryAfterSec: limited.retryAfterSec,
        },
        429,
        { "Retry-After": String(limited.retryAfterSec) },
      );
    }

    try {
      const lookup = await lookupBdpnNumber(number, request.signal);
      return json(lookup, 200);
    } catch (error) {
      if (
        request.signal.aborted ||
        (error instanceof BdpnLookupError && error.code === "ABORTED")
      ) {
        return json({ error: "БДПН: проверка прервана.", code: "ABORTED" }, 502);
      }
      if (error instanceof BdpnLookupError) {
        const status = error.code === "INVALID" ? 400 : 502;
        return json({ error: error.message, code: error.code }, status);
      }
      return json({ error: "БДПН: нет соединения с сервисом.", code: "NETWORK" }, 502);
    }
  } finally {
    releaseBdpnLookup(userId);
  }
}
