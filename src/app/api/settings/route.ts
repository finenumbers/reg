import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import {
  getSettingsView,
  settingsUpdateSchema,
  updateSettings,
} from "@/modules/settings";

/**
 * GET /api/settings — masked settings state (settings:write).
 * PUT /api/settings — update non-secret settings + SSH host/port/username.
 */
export async function GET() {
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  const settings = await getSettingsView();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  // Reject any attempt to smuggle key/command fields through settings update.
  if (body && typeof body === "object") {
    const banned = [
      "command",
      "scriptPath",
      "remoteArgs",
      "privateKey",
      "privateKeyCiphertext",
      "rawKeyMaterial",
      "passphrase",
    ] as const;
    for (const key of banned) {
      if (key in (body as Record<string, unknown>)) {
        return NextResponse.json(
          {
            error: `Field '${key}' is not allowed on settings update — use the key replace endpoint for key material`,
            code: "BAD_REQUEST",
          },
          { status: 400 },
        );
      }
    }
  }

  try {
    const input = settingsUpdateSchema.parse(body);
    const ip = await getRequestIp();
    const result = await updateSettings(input, {
      userId: gate.ctx.session.user.id,
      ip,
    });
    return NextResponse.json({
      settings: result.settings,
      createdProfile: result.createdProfile,
    });
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
    throw error;
  }
}
