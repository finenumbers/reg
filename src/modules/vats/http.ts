import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import type { PermissionCode } from "@/modules/rbac/permissions";

export async function requireVatsUser(permission: PermissionCode): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const gate = await requireApiPermission(permission);
  if (!gate.ok) return gate;
  if (gate.ctx.authKind !== "session") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Ключ API не может обращаться к ВАТС.", code: "FORBIDDEN" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: gate.ctx.session.user.id };
}
