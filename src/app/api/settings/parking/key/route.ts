import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { drainParkingCalls } from "@/modules/antifraud/ingest";
import { replaceParkingPrivateKey } from "@/modules/antifraud/secret";
import { isKeyImportError } from "@/modules/ssh/errors";
import { keyReplaceSchema } from "@/modules/settings/schemas";

/** PUT /api/settings/parking/key — replace the parking read key. Never returns key material. */
export async function PUT(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const parsed = keyReplaceSchema.parse(body);
    const ip = await getRequestIp();
    const status = await replaceParkingPrivateKey(parsed, { userId, ip });
    void drainParkingCalls();
    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    if (isKeyImportError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }
    throw error;
  }
}
