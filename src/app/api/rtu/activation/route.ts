import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import {
  changeEndpointActivation,
  parseActivationBody,
} from "@/modules/phones/activation";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/rtu/activation
 * One «Запись активна» change after the phone number is typed.
 * The client sends the status and title it showed. It does not send the target status.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:activate");
  if (!gate.ok) return gate.response;
  if (gate.ctx.authKind === "api_key") {
    return NextResponse.json(
      { error: "API keys cannot change equipment status", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }
  const parsed = parseActivationBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await changeEndpointActivation({
    endpointId: parsed.endpointId,
    phone: parsed.phone,
    activation: parsed.activation,
    title: parsed.title,
    actorUserId: userId,
  });
  return NextResponse.json(
    {
      ok: result.ok,
      message: result.message,
      ...(result.screenPending ? { screenPending: true } : {}),
    },
    { status: result.busy ? 409 : 200 },
  );
}
