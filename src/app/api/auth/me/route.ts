import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";

/**
 * Thin session + RBAC wrapper for UI/clients.
 * GET /api/auth/me
 */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const { ctx } = gate;
  return NextResponse.json({
    user: {
      id: ctx.session.user.id,
      name: ctx.session.user.name,
      username: ctx.username,
      email: ctx.session.user.email,
    },
    roles: ctx.authz.roles,
    permissions: ctx.authz.permissions,
  });
}
