import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { createApiKey, listApiKeys } from "@/modules/api-keys/service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

/**
 * GET /api/settings/api-keys — list keys (no secrets).
 * POST /api/settings/api-keys — create key; returns plaintext secret once.
 */
export async function GET() {
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  const keys = await listApiKeys();
  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
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
    const input = createSchema.parse(body);
    const ip = await getRequestIp();
    const created = await createApiKey({
      name: input.name,
      createdByUserId: userId,
      ip,
    });
    return NextResponse.json(
      {
        key: created.key,
        apiKey: created.apiKey,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          issues: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "INVALID_NAME") {
      return NextResponse.json(
        { error: "Invalid name", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    throw error;
  }
}
