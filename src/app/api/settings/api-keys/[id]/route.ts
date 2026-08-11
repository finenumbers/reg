import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { revokeApiKey } from "@/modules/api-keys/service";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/settings/api-keys/[id] — revoke (disable) a key.
 */
export async function DELETE(request: Request, { params }: Params) {
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "Missing id", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const ip = await getRequestIp();
  const key = await revokeApiKey({ id, actorUserId: userId, ip });
  if (!key) {
    return NextResponse.json(
      { error: "Not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json({ key });
}
