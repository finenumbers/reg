import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import {
  replaceRtuSoapPassword,
  rtuSoapPasswordReplaceSchema,
} from "@/modules/settings";
import { requireSessionUserId } from "@/modules/auth/session";

/**
 * PUT /api/settings/rtu/key — replace the RTU SOAP password.
 * Stores ciphertext locally. Does not call the switch.
 */
export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const parsed = rtuSoapPasswordReplaceSchema.parse(body);
    const ip = await getRequestIp();
    const settings = await replaceRtuSoapPassword(parsed, { userId, ip });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    throw error;
  }
}
