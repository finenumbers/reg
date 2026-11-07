import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { fillRtuPstn } from "@/modules/rtu/pstn-fill";
import { parsePstnFillIds } from "@/modules/rtu/pstn-fill-contract";

export const runtime = "nodejs";

/**
 * POST /api/rtu/pstn-fill
 * Session + phones:read. Looks up cache misses for catalog endpoint ids.
 * API keys cannot call it. Does not refresh rows already in pstn_phone_cache.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const parsed = parsePstnFillIds(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid ids", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const data = await fillRtuPstn(parsed.ids);
  return NextResponse.json(data);
}
