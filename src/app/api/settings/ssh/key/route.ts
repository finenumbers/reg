import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { keyReplaceSchema, replaceSshPrivateKey } from "@/modules/settings";
import { isKeyImportError } from "@/modules/ssh/errors";

/**
 * PUT /api/settings/ssh/key — replace SSH private key (settings:write).
 * Accepts JSON { rawKeyMaterial, passphrase? } or multipart form fields.
 * Never returns key material — only masked settings view.
 */
export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let rawKeyMaterial: string | undefined;
  let passphrase: string | undefined;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("keyFile");
      const pasted = form.get("rawKeyMaterial");
      const pass = form.get("passphrase");

      if (typeof pass === "string" && pass.length > 0) {
        passphrase = pass;
      }

      if (file instanceof File) {
        rawKeyMaterial = await file.text();
      } else if (typeof pasted === "string") {
        rawKeyMaterial = pasted;
      }
    } else {
      const body = (await request.json()) as unknown;
      const parsed = keyReplaceSchema.parse(body);
      rawKeyMaterial = parsed.rawKeyMaterial;
      passphrase = parsed.passphrase;
    }
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
    return NextResponse.json(
      { error: "Invalid request body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  if (!rawKeyMaterial || rawKeyMaterial.trim().length === 0) {
    return NextResponse.json(
      { error: "Key material is required", code: "KEY_EMPTY" },
      { status: 400 },
    );
  }

  try {
    const ip = await getRequestIp();
    const settings = await replaceSshPrivateKey(
      { rawKeyMaterial, passphrase },
      { userId: gate.ctx.session.user.id, ip },
    );
    return NextResponse.json({ settings });
  } catch (error) {
    if (isKeyImportError(error)) {
      const status =
        error.code === "KEY_TOO_LARGE"
          ? 413
          : error.code === "WRONG_PASSPHRASE" ||
              error.code === "PASSPHRASE_REQUIRED"
            ? 400
            : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    throw error;
  }
}
